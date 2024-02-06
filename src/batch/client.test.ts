import { BatchTranscription } from './';
import { request } from '../utils/request';

jest.mock('../utils/request');
const mockedRequest = jest.mocked(request);

describe('BatchTranscription', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('can be initialized with just an API key string', async () => {
    const batch = new BatchTranscription('apiKey');
    expect(batch.apiKey).toBe('apiKey');
  });

  it('can be initialized with a function to get the apiKey', async () => {
    const batch = new BatchTranscription({
      async apiKey() {
        return 'asyncApiKey';
      },
    });
    await batch.refreshApiKey();
    expect(batch.apiKey).toBe('asyncApiKey');
  });

  it('refreshes the API key only once to initialize', async () => {
    const apiKey = jest.fn(async () => 'asyncApiKey');
    const batch = new BatchTranscription({ apiKey });

    mockedRequest.mockImplementation(async () => ({ jobs: [] }));
    await batch.listJobs();
    await batch.listJobs();

    expect(apiKey).toBeCalledTimes(1);
  });

  it('refreshes the API key on error and retries', async () => {
    const keys: IterableIterator<string> = ['firstKey', 'secondKey'][
      Symbol.iterator
    ]();
    const apiKey: () => Promise<string> = jest.fn(
      async () => keys.next().value,
    );

    const batch = new BatchTranscription({ apiKey });

    mockedRequest.mockImplementation(async (apiKey: string) => {
      if (apiKey === 'firstKey') {
        throw new Error('401 Unauthorized (mock)');
      } else {
        return { jobs: [] };
      }
    });

    const result = await batch.listJobs();
    expect(apiKey).toBeCalledTimes(2);
    expect(result.jobs).toBeInstanceOf(Array);
  });

  // it('returns a descriptive error when the given API key is invalid', async () => {
  //   mockedRequest.mockImplementation(async () => {
  //     throw new Error('401 Unauthorized (mock)');
  //   });

  //   const batch = new BatchTranscription({ apiKey: 'some-invalid-key' });
  //   expect(batch.listJobs()).rejects;
  // });
});
