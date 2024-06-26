import { version } from './version.js'
import type { Fetch, ErrorResponse } from './interfaces.js'
import {
  EMPTY_STRING,
  ENCODING,
  MESSAGES,
  OLLAMA_LOCAL_URL,
  PORTS,
  PROTOCOLS,
} from './constants'
import { promises } from 'fs'

/**
 * An error class for response errors.
 * @extends Error
 */
class ResponseError extends Error {
  constructor(
    public error: string,
    public status_code: number,
  ) {
    super(error)
    this.name = 'ResponseError'

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ResponseError)
    }
  }
}

/**
 * Checks if the response is ok, if not throws an error.
 * If the response is not ok, it will try to parse the response as JSON and use the error field as the error message.
 * @param response {Response} - The response object to check
 */
const checkOk = async (response: Response): Promise<void> => {
  if (response.ok) {
    return
  }
  let message = `Error ${response.status}: ${response.statusText}`
  let errorData: ErrorResponse | null = null

  if (response.headers.get('content-type')?.includes('application/json')) {
    try {
      errorData = (await response.json()) as ErrorResponse
      message = errorData.error || message
    } catch (error) {
      console.log(MESSAGES.ERROR_JSON_PARSE)
    }
  } else {
    try {
      console.log(MESSAGES.FETCHING_TEXT)
      const textResponse = await response.text()
      message = textResponse || message
    } catch (error) {
      console.log(MESSAGES.ERROR_FETCHING_TEXT)
    }
  }

  throw new ResponseError(message, response.status)
}

/**
 * Returns the platform string based on the environment.
 * @returns {string} - The platform string
 */
function getPlatform(): string {
  if (typeof window !== 'undefined' && window.navigator) {
    return `${window.navigator.platform.toLowerCase()} Browser/${navigator.userAgent};`
  } else if (typeof process !== 'undefined') {
    return `${process.arch} ${process.platform} Node.js/${process.version}`
  }
  return '' // unknown
}

/**
 * A wrapper around fetch that adds default headers.
 * @param fetch {Fetch} - The fetch function to use
 * @param url {string} - The URL to fetch
 * @param options {RequestInit} - The fetch options
 * @returns {Promise<Response>} - The fetch response
 */
const fetchWithHeaders = async (
  fetch: Fetch,
  url: string,
  options: RequestInit = {},
): Promise<Response> => {
  const defaultHeaders = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'User-Agent': `ollama-js/${version} (${getPlatform()})`,
  }

  if (!options.headers) {
    options.headers = {}
  }

  options.headers = {
    ...defaultHeaders,
    ...options.headers,
  }

  return fetch(url, options)
}

/**
 * A wrapper around the get method that adds default headers.
 * @param fetch {Fetch} - The fetch function to use
 * @param host {string} - The host to fetch
 * @returns {Promise<Response>} - The fetch response
 */
export const get = async (fetch: Fetch, host: string): Promise<Response> => {
  const response = await fetchWithHeaders(fetch, host)

  await checkOk(response)

  return response
}
/**
 * A wrapper around the head method that adds default headers.
 * @param fetch {Fetch} - The fetch function to use
 * @param host {string} - The host to fetch
 * @returns {Promise<Response>} - The fetch response
 */
export const head = async (fetch: Fetch, host: string): Promise<Response> => {
  const response = await fetchWithHeaders(fetch, host, {
    method: 'HEAD',
  })

  await checkOk(response)

  return response
}
/**
 * A wrapper around the post method that adds default headers.
 * @param fetch {Fetch} - The fetch function to use
 * @param host {string} - The host to fetch
 * @param data {Record<string, unknown> | BodyInit} - The data to send
 * @param options {{ signal: AbortSignal }} - The fetch options
 * @returns {Promise<Response>} - The fetch response
 */
export const post = async (
  fetch: Fetch,
  host: string,
  data?: Record<string, unknown> | BodyInit,
  options?: { signal: AbortSignal },
): Promise<Response> => {
  const isRecord = (input: any): input is Record<string, unknown> => {
    return input !== null && typeof input === 'object' && !Array.isArray(input)
  }

  const formattedData = isRecord(data) ? JSON.stringify(data) : data

  const response = await fetchWithHeaders(fetch, host, {
    method: 'POST',
    body: formattedData,
    signal: options?.signal,
  })

  await checkOk(response)

  return response
}
/**
 * A wrapper around the delete method that adds default headers.
 * @param fetch {Fetch} - The fetch function to use
 * @param host {string} - The host to fetch
 * @param data {Record<string, unknown>} - The data to send
 * @returns {Promise<Response>} - The fetch response
 */
export const del = async (
  fetch: Fetch,
  host: string,
  data?: Record<string, unknown>,
): Promise<Response> => {
  const response = await fetchWithHeaders(fetch, host, {
    method: 'DELETE',
    body: JSON.stringify(data),
  })

  await checkOk(response)

  return response
}
/**
 * Parses a ReadableStream of Uint8Array into JSON objects.
 * @param itr {ReadableStream<Uint8Array>} - The stream to parse
 * @returns {AsyncGenerator<T>} - The parsed JSON objects
 */
export const parseJSON = async function* <T = unknown>(
  itr: ReadableStream<Uint8Array>,
): AsyncGenerator<T> {
  const decoder = new TextDecoder(ENCODING.UTF8)
  let buffer = EMPTY_STRING

  const reader = itr.getReader()

  while (true) {
    const { done, value: chunk } = await reader.read()

    if (done) {
      break
    }

    buffer += decoder.decode(chunk)

    const parts = buffer.split('\n')

    buffer = parts.pop() ?? EMPTY_STRING

    for (const part of parts) {
      try {
        yield JSON.parse(part)
      } catch (error) {
        console.warn('invalid json: ', part)
      }
    }
  }

  for (const part of buffer.split('\n').filter((p) => p !== '')) {
    try {
      yield JSON.parse(part)
    } catch (error) {
      console.warn('invalid json: ', part)
    }
  }
}
/**
 * Formats the host string to include the protocol and port.
 * @param host {string} - The host string to format
 * @returns {string} - The formatted host string
 */
export const formatHost = (host: string): string => {
  if (!host) {
    return OLLAMA_LOCAL_URL
  }

  let isExplicitProtocol = host.includes('://')

  if (host.startsWith(':')) {
    // if host starts with ':', prepend the default hostname
    host = `http://127.0.0.1${host}`
    isExplicitProtocol = false
  }

  if (!isExplicitProtocol) {
    host = `http://${host}`
  }

  const url = new URL(host)

  let port = url.port
  if (!port) {
    if (!isExplicitProtocol) {
      port = '11434'
    } else {
      // Assign default ports based on the protocol
      port = url.protocol === `${PROTOCOLS.HTTPS}:` ? PORTS.HTTPS : PORTS.HTTP
    }
  }

  let formattedHost = `${url.protocol}//${url.hostname}:${port}${url.pathname}`
  // remove trailing slashes
  if (formattedHost.endsWith('/')) {
    formattedHost = formattedHost.slice(0, -1)
  }

  return formattedHost
}

/**
 * Checks if a path is a file path
 * @param path {string} - The path to check
 * @returns {Promise<boolean>} - Whether the path is a file path or not
 */
export async function isFilePath(path: string): Promise<boolean> {
  try {
    await promises.access(path)
    return true
  } catch {
    return false
  }
}
/**
 * checks if a file exists
 * @param path {string} - The path to the file
 * @private @internal
 * @returns {Promise<boolean>} - Whether the file exists or not
 */
export async function fileExists(path: string): Promise<boolean> {
  try {
    await promises.access(path)
    return true
  } catch {
    return false
  }
}
