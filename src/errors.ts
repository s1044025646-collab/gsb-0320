export type ErrorCode =
  | 'BAD_REQUEST'
  | 'INVALID_JSON'
  | 'COLORS_INVALID'
  | 'SLOTS_INVALID'
  | 'TOO_MANY_CANDIDATES'
  | 'NOT_FOUND'
  | 'SEQUENCE_LENGTH'
  | 'COLOR_INDEX_OUT_OF_RANGE'
  | 'SEQUENCE_NOT_ARRAY'
  | 'FEEDBACK_INVALID'
  | 'PAGE_INVALID'
  | 'BUDGET_INVALID'
  | 'INTERNAL';

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;
  readonly httpStatus: number;

  constructor(code: ErrorCode, message: string, details?: unknown, httpStatus?: number) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
    this.httpStatus = httpStatus ?? defaultStatus(code);
  }
}

function defaultStatus(code: ErrorCode): number {
  switch (code) {
    case 'NOT_FOUND':
      return 404;
    case 'INTERNAL':
      return 500;
    default:
      return 400;
  }
}
