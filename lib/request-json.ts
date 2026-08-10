export type LimitedJsonResult =
  | { readonly ok: true; readonly value: unknown }
  | {
      readonly ok: false;
      readonly status: 400 | 413 | 415;
      readonly code: string;
      readonly message: string;
    };

export async function readLimitedJsonBody(
  request: Request,
  maximumBytes: number,
): Promise<LimitedJsonResult> {
  const contentEncoding = request.headers.get("content-encoding")?.trim().toLowerCase();
  if (contentEncoding && contentEncoding !== "identity") {
    return {
      ok: false,
      status: 415,
      code: "unsupported_content_encoding",
      message: "Compressed request bodies are not accepted.",
    };
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    const declaredBytes = Number(contentLength);
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes < 0) {
      return {
        ok: false,
        status: 400,
        code: "invalid_content_length",
        message: "Content-Length must be a non-negative integer.",
      };
    }
    if (declaredBytes > maximumBytes) {
      return {
        ok: false,
        status: 413,
        code: "request_too_large",
        message: `The request body must not exceed ${maximumBytes} bytes.`,
      };
    }
  }

  if (!request.body) {
    return {
      ok: false,
      status: 400,
      code: "invalid_json",
      message: "The request body must be valid JSON.",
    };
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let totalBytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel("request_too_large");
        return {
          ok: false,
          status: 413,
          code: "request_too_large",
          message: `The request body must not exceed ${maximumBytes} bytes.`,
        };
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return {
      ok: false,
      status: 400,
      code: "invalid_json",
      message: "The request body must be valid JSON.",
    };
  } finally {
    reader.releaseLock();
  }
}

export function limitedJsonError(result: Exclude<LimitedJsonResult, { readonly ok: true }>): Response {
  return Response.json(
    { code: result.code, message: result.message },
    { status: result.status, headers: { "Cache-Control": "private, no-store" } },
  );
}
