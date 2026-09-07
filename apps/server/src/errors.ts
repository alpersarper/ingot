/**
 * One error shape for the whole API.
 *
 * Routes throw `ApiError`; the app's error handler turns it into a JSON body
 * the panel can render. Anything else that escapes a route is a bug, so it is
 * logged and reported as a 500 without its message -- an internal message could
 * carry a file path or, worse, a secret.
 */
export class ApiError extends Error {
  readonly status: ApiStatus
  readonly code: string
  readonly details: readonly string[] | undefined

  constructor(status: ApiStatus, code: string, message: string, details?: readonly string[]) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }

  static badRequest(message: string, details?: readonly string[]): ApiError {
    return new ApiError(400, 'bad_request', message, details)
  }

  static unauthorized(message: string): ApiError {
    return new ApiError(401, 'unauthorized', message)
  }

  static forbidden(message: string): ApiError {
    return new ApiError(403, 'forbidden', message)
  }

  static notFound(message: string): ApiError {
    return new ApiError(404, 'not_found', message)
  }

  static conflict(message: string): ApiError {
    return new ApiError(409, 'conflict', message)
  }

  static unprocessable(message: string, details?: readonly string[]): ApiError {
    return new ApiError(422, 'unprocessable', message, details)
  }
}

/** The statuses routes actually raise, so the handler needs no cast. */
export type ApiStatus = 400 | 401 | 403 | 404 | 409 | 422 | 500

export interface ApiErrorBody {
  error: { code: string; message: string; details?: readonly string[] }
}

export function errorBody(error: ApiError): ApiErrorBody {
  return {
    error: {
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
    },
  }
}
