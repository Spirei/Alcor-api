/** Wire failures never expose response HTML or turn an uncertain write into success. */
export class ApiError extends Error {
  status: number;
  requestId: string;
  code: string;
  constructor(status: number, message: string, requestId = "", code = "") {
    super(message);
    this.status = status;
    this.requestId = requestId;
    this.code = code;
  }
}
const transportMessage = (read: boolean) =>
  read
    ? "网络连接失败，请稍后重试"
    : "网络连接中断，操作结果尚未确认，请核对原操作";
export async function requestResponse(
  input: string,
  options: RequestInit = {},
  read = ["GET", "HEAD"].includes((options.method || "GET").toUpperCase()),
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  try {
    return await fetcher(input, options);
  } catch (reason) {
    if (!options.signal?.aborted && reason instanceof TypeError)
      throw new ApiError(0, transportMessage(read), "", "network_error");
    throw reason;
  }
}
export async function responseJson(
  response: Response,
  read: boolean,
): Promise<unknown> {
  try {
    return await response.json();
  } catch (reason) {
    if (reason instanceof SyntaxError)
      throw new ApiError(
        response.status,
        read
          ? "服务响应格式异常，请重新读取"
          : "服务响应格式异常，请核对原操作结果",
        "",
        "invalid_response",
      );
    if (reason instanceof TypeError)
      throw new ApiError(0, transportMessage(read), "", "network_error");
    throw reason;
  }
}
