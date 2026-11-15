import type { ValidationError } from '@nestjs/common';

/**
 * One reason a request was rejected, in the shape this API returns to clients.
 * `path` is dot-separated (`data.subjects`), so a front end can highlight the
 * exact input that failed.
 */
export interface ValidationIssue {
  path: string;
  message: string;
}

/**
 * class-validator reports failures as a tree: a parent error for an object with
 * nested DTOs carries its own constraints plus a `children` array. The API
 * contract is a flat list, so the tree is walked depth-first and every leaf
 * becomes one `{ path, message }` entry.
 */
export function describeValidationErrors(
  errors: ValidationError[],
  prefix = '',
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const error of errors) {
    const path = prefix ? `${prefix}.${error.property}` : error.property;

    if (error.constraints) {
      // One property can break several rules; both messages are useful.
      issues.push({ path, message: Object.values(error.constraints).join('; ') });
    }
    if (error.children?.length) {
      issues.push(...describeValidationErrors(error.children, path));
    }
  }

  return issues;
}
