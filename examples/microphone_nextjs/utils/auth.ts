export function getJwt() {
  return fetch(`https://mp.speechmatics.com/v1/api_keys?type=rt`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer h2qId2K4PIp4yYQDqmfm2mbSpW56twge`,
    },
    body: JSON.stringify({ ttl: 3600 }),
  })
    .then((res) => res.json())
    .then((data) => data.key_value);
}
