import type { ValidationError } from '@nestjs/common';

export interface ValidationIssue {
  path: string;
  message: string;
}

export function describeValidationErrors(
  errors: ValidationError[],
  prefix = '',
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const error of errors) {
    const path = prefix ? `${prefix}.${error.property}` : error.property;

    if (error.constraints) {
      issues.push({ path, message: Object.values(error.constraints).join('; ') });
    }
    if (error.children?.length) {
      issues.push(...describeValidationErrors(error.children, path));
    }
  }

  return issues;
}
