import { connect } from "cloudflare:sockets";

const VLESS_UUID = "";
const PROXY_IP = "";
const CONNECT_TIMEOUT_MS = 3_000;
const MAX_VLESS_HEADER_BYTES = 8_192;
const EMPTY_BYTES = new Uint8Array(0);
const TEXT_DECODER = new TextDecoder();
const UUID_BYTES = Uint8Array.from(
  VLESS_UUID.replaceAll("-", "").match(/.{2}/g),
  hex => Number.parseInt(hex, 16)
);

function concatBytes(left, right) {
  const merged = new Uint8Array(left.byteLength + right.byteLength);
  merged.set(left);
  merged.set(right, left.byteLength);
  return merged;
}

function matchesUuid(buffer) {
  for (let index = 0; index < UUID_BYTES.length; index++) {
    if (buffer[index + 1] !== UUID_BYTES[index]) return false;
  }
  return true;
}

function parseVlessRequest(buffer) {
  if (buffer.byteLength < 18) return null;
  if (buffer[0] !== 0) throw new Error("invalid vless version");
  if (!matchesUuid(buffer)) throw new Error("invalid vless uuid");

  const commandOffset = 18 + buffer[17];
  if (buffer.byteLength < commandOffset + 4) return null;
  if (buffer[commandOffset] !== 1) throw new Error("tcp only");

  const port = (buffer[commandOffset + 1] << 8) | buffer[commandOffset + 2];
  if (port === 0) throw new Error("invalid port");

  const addressType = buffer[commandOffset + 3];
  let offset = commandOffset + 4;
  let hostname;

  if (addressType === 1) {
    if (buffer.byteLength < offset + 4) return null;
    hostname = `${buffer[offset]}.${buffer[offset + 1]}.${buffer[offset + 2]}.${buffer[offset + 3]}`;
    offset += 4;
  } else if (addressType === 2) {
    if (buffer.byteLength < offset + 1) return null;
    const length = buffer[offset++];
    if (length === 0) throw new Error("empty domain");
    if (buffer.byteLength < offset + length) return null;
    hostname = TEXT_DECODER.decode(buffer.subarray(offset, offset + length));
    offset += length;
  } else if (addressType === 3) {
    if (buffer.byteLength < offset + 16) return null;
    const groups = [];
    for (let index = 0; index < 8; index++) {
      groups.push(((buffer[offset + index * 2] << 8) | buffer[offset + index * 2 + 1]).toString(16));
    }
    hostname = groups.join(":");
    offset += 16;
  } else {
    throw new Error("invalid address type");
  }

  return {
    version: buffer[0],
    hostname,
    port,
    dataOffset: offset
  };
}

async function readVlessHeader(request) {
  const reader = request.body.getReader();
  let buffered = EMPTY_BYTES;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) throw new Error("incomplete vless header");

      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
      buffered = buffered.byteLength ? concatBytes(buffered, chunk) : chunk.slice();

      const parsed = parseVlessRequest(buffered);
      if (parsed) {
        reader.releaseLock();
        return {
          ...parsed,
          initialPayload: buffered.subarray(parsed.dataOffset).slice()
        };
      }

      if (buffered.byteLength > MAX_VLESS_HEADER_BYTES) {
        throw new Error("vless header too large");
      }
    }
  } catch (error) {
    try {
      await reader.cancel(error);
    } catch {}
    throw error;
  }
}

async function openTcpSocket(hostname, port) {
  const socket = connect({ hostname, port });
  let timeout;

  try {
    await Promise.race([
      socket.opened,
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("tcp connect timeout")),
          CONNECT_TIMEOUT_MS
        );
      })
    ]);
    return socket;
  } catch (error) {
    try {
      socket.close();
    } catch {}
    throw error;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

async function openTcpSocketWithFallback(hostname, port) {
  try {
    return await openTcpSocket(hostname, port);
  } catch (primaryError) {
    try {
      return await openTcpSocket(PROXY_IP, 443);
    } catch (fallbackError) {
      throw fallbackError ?? primaryError;
    }
  }
}

function isVlessXhttpRequest(request) {
  if (request.method !== "POST" || !request.body) return false;
  const contentType = request.headers.get("Content-Type");
  return !!contentType && contentType.toLowerCase().startsWith("application/grpc");
}

async function handleVlessXhttp(request) {
  let header;

  try {
    header = await readVlessHeader(request);
  } catch {
    return new Response("bad request", { status: 400 });
  }

  let socket;

  try {
    socket = await openTcpSocketWithFallback(header.hostname, header.port);
  } catch {
    try {
      await request.body.cancel();
    } catch {}
    return new Response("bad gateway", { status: 502 });
  }

  const abortController = new AbortController();
  let socketClosed = false;

  const cleanup = reason => {
    if (!abortController.signal.aborted) {
      try {
        abortController.abort(reason);
      } catch {}
    }

    if (!socketClosed) {
      socketClosed = true;
      try {
        socket.close();
      } catch {}
    }
  };

  const uploadPromise = (async () => {
    const writer = socket.writable.getWriter();
    try {
      if (header.initialPayload.byteLength) {
        await writer.write(header.initialPayload);
      }
    } finally {
      writer.releaseLock();
    }

    await request.body.pipeTo(socket.writable, {
      signal: abortController.signal
    });
  })();

  const responseStream = new IdentityTransformStream();

  const downloadPromise = (async () => {
    const writer = responseStream.writable.getWriter();
    try {
      await writer.write(new Uint8Array([header.version, 0]));
    } catch (error) {
      try {
        await writer.abort(error);
      } catch {}
      throw error;
    } finally {
      writer.releaseLock();
    }

    await socket.readable.pipeTo(responseStream.writable, {
      signal: abortController.signal
    });
  })();

  void uploadPromise.catch(cleanup);
  void downloadPromise.then(() => cleanup(), cleanup);
  void Promise.allSettled([uploadPromise, downloadPromise]);

  return new Response(responseStream.readable, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no"
    }
  });
}

function notFoundResponse() {
  return new Response(
    "<html><head><title>404 Not Found</title></head><body><center><h1>404 Not Found</h1></center><hr><center>nginx</center></body></html>",
    {
      status: 404,
      headers: {
        "Content-Type": "text/html; charset=UTF-8"
      }
    }
  );
}

export default {
  async fetch(request) {
    if (!isVlessXhttpRequest(request)) return notFoundResponse();
    return handleVlessXhttp(request);
  }
};
