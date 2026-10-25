async function handle(res) {
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || res.statusText);
  return json;
}

export const api = {
  get: (path) => fetch(path).then(handle),
  post: (path, body = {}) => fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(handle),
  upload: (file) => {
    const form = new FormData();
    form.append("file", file);
    return fetch("/api/files", { method: "POST", body: form }).then(handle);
  },
};

export const ipfsUrl = (cid) => `/ipfs/${cid}`;
