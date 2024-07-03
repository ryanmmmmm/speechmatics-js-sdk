import { GetServerSideProps } from 'next';
import dynamic from 'next/dynamic';
import React, {
  useState,
  useMemo,
  useRef,
  CSSProperties,
  useEffect,
} from 'react';
import { RealtimeSession, RealtimeRecognitionResult } from 'speechmatics';
import {
  AudioRecorder,
  useAudioDenied,
  useAudioDevices,
  useRequestDevices,
} from '../utils/recorder';
import { getJwt } from '../utils/auth';

// The mic drop down can be populated with client state, so we don't server render it to prevent hydration errors
const MicSelect = dynamic(() => import('../components/MicSelect'), {
  ssr: false,
});

type MainProps = { jwt?: string };

type SessionState = 'configure' | 'starting' | 'blocked' | 'error' | 'running';

export default function Main({ jwt }: MainProps) {
  const [transcription, setTranscription] = useState<RealtimeRecognitionResult[]>([]);
  const [partial, setPartial] = useState<string>('');
  const [spanishTranscription, setSpanishTranscription] = useState<RealtimeRecognitionResult[]>([]);
  const [spanishPartial, setSpanishPartial] = useState<string>('');
  const [audioDeviceIdState, setAudioDeviceId] = useState<string>('');
  const [sessionState, setSessionState] = useState<SessionState>('configure');
  const [bearerToken, setBearerToken] = useState<string>('');
  const [bufferedText, setBufferedText] = useState<string>('');
  const [apiQueue, setApiQueue] = useState<string[]>([]);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);

  const rtSessionRef = useRef<RealtimeSession>(new RealtimeSession(jwt));
  const audioRef = useRef<HTMLAudioElement>(null);
  const [processedText, setProcessedText] = useState<string>('');

  // Get devices using our custom hook
  const devices = useAudioDevices();
  const denied = useAudioDenied();
  const requestDevices = useRequestDevices();

  const audioDeviceIdComputed =
    devices.length &&
    !devices.some((item) => item.deviceId === audioDeviceIdState)
      ? devices[0].deviceId
      : audioDeviceIdState;

  // sendAudio is used as a wrapper for the websocket to check the socket is finished init-ing before sending data
  const sendAudio = (data: Blob) => {
    if (
      rtSessionRef.current.rtSocketHandler &&
      rtSessionRef.current.isConnected()
    ) {
      rtSessionRef.current.sendAudio(data);
    }
  };

  // Memoise AudioRecorder so it doesn't get recreated on re-render
  const audioRecorder = useMemo(() => new AudioRecorder(sendAudio), []);

  const authenticate = async () => {
    try {
      const response = await fetch('http://localhost/v1/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: 'ryan+credits@speechlab.ai',
          password: '1374Pre96',
        }),
      });

      if (!response.ok) {
        throw new Error('Authentication failed');
      }

      const data = await response.json();
      setBearerToken(data.tokens.accessToken.jwtToken);
      console.log('Authenticated successfully, bearer token set.');
    } catch (error) {
      console.error('Error during authentication:', error);
    }
  };

  const playAudioQueue = async () => {
    if (isPlaying || apiQueue.length === 0) return;

    setIsPlaying(true);
    const text = apiQueue[0];

    try {
      console.log('Making API call with text:', text);
      const response = await fetch('http://localhost/v1/texttospeeches/generateAndrew', {
        method: 'POST',
        headers: {
          'Accept': 'application/json, text/plain, */*',
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${bearerToken}`,
        },
        body: JSON.stringify({ text }),
      });

      if (!response.ok) {
        throw new Error('Network response was not ok');
      }

      const audioData = await response.arrayBuffer();
      console.log('Received audio data for text:', text);

      // Create a Blob from the audio data
      const blob = new Blob([audioData], { type: 'audio/wav' });
      const url = URL.createObjectURL(blob);

      // Set the Blob URL as the source for the audio element and play
      if (audioRef.current) {
        audioRef.current.src = url;
        await audioRef.current.play().catch(err => console.error('Error playing audio:', err));
      }
    } catch (error) {
      console.error('Error processing text:', text, error);
    }

    setProcessedText(text); // Update the processed text state
    setApiQueue((prevQueue) => prevQueue.slice(1)); // Remove the processed item from the queue
    setIsPlaying(false);
  };

  useEffect(() => {
    if (!isPlaying && apiQueue.length > 0) {
      playAudioQueue();
    }
  }, [apiQueue, isPlaying]);

  const handleAddTranscript = (res) => {
    setTranscription((prev) => [...prev, ...res.results]);
    setPartial('');
    const newText = res.results.map(r => r.alternatives[0].content).join(' ').trim();

    if (newText) {
      setApiQueue((prevQueue) => [...prevQueue, newText]);
    }
  };

  const handleAddPartialTranscript = (res) => {
    let temp = "";
    if (transcription.length) {
      temp += " ";
    }
    setPartial(`${temp}${res.metadata.transcript}`);
  };

  const handleAddTranslation = (res) => {
    setSpanishTranscription((prev) => [...prev, ...res.results]);
  };

  const handleAddPartialTranslation = (res) => {
    let tempSpanish = "";
    if (spanishTranscription.length) {
      tempSpanish += " ";
    }
    setSpanishPartial(`${tempSpanish}${res.results.map(r => r.content).join(' ')}`);
  };

  // Attach our event listeners to the realtime session
  useEffect(() => {
    const rtSession = rtSessionRef.current;

    rtSession.addListener('AddTranscript', handleAddTranscript);
    rtSession.addListener('AddTranslation', handleAddTranslation);
    rtSession.addListener('AddPartialTranslation', handleAddPartialTranslation);

    return () => {
      rtSession.removeListener('AddTranscript', handleAddTranscript);
      rtSession.removeListener('AddTranslation', handleAddTranslation);
      rtSession.removeListener('AddPartialTranslation', handleAddPartialTranslation);
    };
  }, [transcription, spanishTranscription, bearerToken]);

  // start audio recording once the websocket is connected
  rtSessionRef.current.addListener('RecognitionStarted', async () => {
    setSessionState('running');
  });

  rtSessionRef.current.addListener('EndOfTranscript', async () => {
    setSessionState('configure');
    await audioRecorder.stopRecording();
  });

  rtSessionRef.current.addListener('Error', async () => {
    setSessionState('error');
    await audioRecorder.stopRecording();
  });

  // Call the start method on click to start the websocket
  const startTranscription = async () => {
    setSessionState('starting');
    try {
      await audioRecorder.startRecording(audioDeviceIdComputed);
      setTranscription([]);
      setSpanishTranscription([]);
    } catch (err) {
      setSessionState('blocked');
      return;
    }
    try {
      await rtSessionRef.current.start({
        transcription_config: { 
          max_delay: 2, 
          language: 'en', 
          operating_point: "enhanced",
          enable_partials: true,
        },
        translation_config: {
          target_languages: ['es']
        },
        audio_format: {
          type: 'file',
        },
      });
    } catch (err) {
      setSessionState('error');
    }
  };

  // Stop the transcription on click to end the recording
  const stopTranscription = async () => {
    await audioRecorder.stopRecording();
    await rtSessionRef.current.stop();
  };

  const handleAudioPlayback = () => {
    const audioElement = audioRef.current;
    if (!audioElement) return;

    audioElement.addEventListener('play', async () => {
      const stream = audioElement.captureStream();
      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);

      source.connect(processor);
      processor.connect(audioContext.destination);

      processor.onaudioprocess = (event) => {
        const inputData = event.inputBuffer.getChannelData(0);
        const audioBlob = new Blob([inputData], { type: 'audio/wav' });
        sendAudio(audioBlob);
      };
    });
  };

  useEffect(() => {
    authenticate();
    handleAudioPlayback(); // Ensure the audio playback handler is set up
  }, []);

  return (
    <div>
      <div className='flex-row'>
        <p>Select Microphone</p>
        {(sessionState === 'blocked' || denied) && (
          <p className='warning-text'>Microphone permission is blocked</p>
        )}
      </div>
      <MicSelect
        disabled={!['configure', 'blocked'].includes(sessionState)}
        onClick={requestDevices}
        value={audioDeviceIdComputed}
        options={devices.map((item) => {
          return { value: item.deviceId, label: item.label };
        })}
        onChange={(e) => {
          if (sessionState === 'configure') {
            setAudioDeviceId(e.target.value);
          } else if (sessionState === 'blocked') {
            setSessionState('configure');
            setAudioDeviceId(e.target.value);
          } else {
            console.warn('Unexpected mic change during state:', sessionState);
          }
        }}
      />
      <TranscriptionButton
        sessionState={sessionState}
        stopTranscription={stopTranscription}
        startTranscription={startTranscription}
      />
      <audio
        ref={audioRef}
        controls
        src="/0b074c26-5262-4fa8-8728-0cb8e2e35712.m4a"
        onCanPlay={handleAudioPlayback} // Set up the playback handler when the audio can play
      />
      {sessionState === 'error' && (
        <p className='warning-text'>Session encountered an error</p>
      )}
      {['starting', 'running', 'configure', 'blocked'].includes(
        sessionState,
      ) && <p>State: {sessionState}</p>}
      <div className="transcription-section">
        <h3>Transcription</h3>
        <p>
          {transcription.map(
            (item, index) =>
              (index && !['.', ','].includes(item?.alternatives?.[0]?.content)
                ? ' '
                : '') + item?.alternatives?.[0]?.content,
          )}
          <em>{partial}</em>
        </p>
      </div>
      <div className="translation-section">
        <h3>Spanish Translation</h3>
        <p>
          {spanishTranscription.map(
            (item, index) =>
              (index && !['.', ','].includes(item?.content)
                ? ' '
                : '') + item?.content,
          )}
          <em>{spanishPartial}</em>
        </p>
      </div>
    </div>
  );
}

// getServerSideProps - used to perform server side preparation
// In this case, the long-lived API key is provided to the server and used to fetch a short-lived JWT
// The short-lived JWT is then given to the client to connect to Speechmatics' service
// This ensures the security of long-lived tokens and reduces the scope for abuse from end users
export const getServerSideProps: GetServerSideProps = async (context) => {
  const jwt = await getJwt();
  if (jwt === undefined) throw new Error('JWT undefined');
  return {
    props: { jwt },
  };
};

// ButtonInfoBar - component for stopping/starting session

type TranscriptionButtonProps = {
  startTranscription: () => void;
  stopTranscription: () => void;
  sessionState: SessionState;
};

function TranscriptionButton({
  startTranscription,
  stopTranscription,
  sessionState,
}: TranscriptionButtonProps) {
  return (
    <div className='bottom-button-status'>
      {['configure', 'stopped', 'starting', 'error', 'blocked'].includes(
        sessionState,
      ) && (
        <button
          type='button'
          className='bottom-button start-button'
          disabled={sessionState === 'starting'}
          onClick={async () => {
            startTranscription();
          }}
        >
          <CircleIcon style={{ marginRight: '0.25em', marginTop: '1px' }} />
          Start Transcribing
        </button>
      )}

      {sessionState === 'running' && (
        <button
          type='button'
          className='bottom-button stop-button'
          onClick={() => stopTranscription()}
        >
          <SquareIcon style={{ marginRight: '0.25em', marginBottom: '1px' }} />
          Stop Transcribing
        </button>
      )}
    </div>
  );
}

function CircleIcon(props: React.SVGProps<SVGSVGElement> & CSSProperties) {
  return (
    <span style={{ ...props.style }}>
      <svg
        width='1em'
        height='1em'
        viewBox='0 0 12 12'
        fill='none'
        xmlns='http://www.w3.org/2000/svg'
        {...props}
      >
        <title>A Circle Icon</title>
        <circle cx={6} cy={6} r={4} fill='#C84031' />
        <path
          fillRule='evenodd'
          clipRule='evenodd'
          d='M6 12A6 6 0 106 0a6 6 0 000 12zm0-.857A5.143 5.143 0 106 .857a5.143 5.143 0 000 10.286z'
          fill='#C84031'
        />
      </svg>
    </span>
  );
}

function SquareIcon(props: React.SVGProps<SVGSVGElement> & CSSProperties) {
  return (
    <span style={{ ...props.style }}>
      <svg
        width={6}
        height={6}
        fill='none'
        xmlns='http://www.w3.org/2000/svg'
        {...props}
      >
        <title>A Square Icon</title>
        <path fill='#fff' d='M0 0h6v6H0z' />
      </svg>
    </span>
  );
}

function PlayIcon(props: React.SVGProps<SVGSVGElement> & CSSProperties) {
  return (
    <span style={{ ...props.style }}>
      <svg
        width='1em'
        height='1em'
        viewBox='0 0 12 12'
        fill='none'
        xmlns='http://www.w3.org/2000/svg'
        {...props}
      >
        <title>A Play Icon</title>
        <polygon points="0,0 12,6 0,12" fill="#C84031" />
      </svg>
    </span>
  );
}