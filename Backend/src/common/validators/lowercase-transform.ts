/**
 * Addresses are compared and stored in lower case, so `Rumman@LMU.EDU` and
 * `rumman@lmu.edu` are the same student. The transform runs before the rules,
 * which is why `@IsEmail()` never has to care about casing.
 *
 * A DTO field that also wants its surrounding spaces gone — a domain typed into
 * a settings form, say — cannot use this and has to trim first, because a
 * transform here would change what `@IsEmail()` validates for every caller.
 */
export const toLowerCase = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.toLowerCase() : value;
