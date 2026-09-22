/**
 * A pure five-field cron expression parser and matcher (Vixie semantics):
 * minute hour day-of-month month day-of-week, numbers only, with the star
 * form, ranges a-b, steps (star-slash-n and a-b-slash-n), and comma lists.
 * The day rule is the classic one: when both day fields are restricted,
 * either may match (OR); otherwise only the restricted field filters. All
 * comparisons are in the host's local time — these are machine-level tasks.
 *
 * @module @dsh-custom/dsh-automations
 */

/** The parsed membership sets of one cron expression. */
export interface CronFields {
  readonly minute: ReadonlySet<number>
  readonly hour: ReadonlySet<number>
  readonly dayOfMonth: ReadonlySet<number>
  readonly month: ReadonlySet<number>
  readonly dayOfWeek: ReadonlySet<number>
}

/** One invalid expression. */
export class CronError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CronError'
  }
}

/** Upper bounds indexed by field position. */
const FIELD_BOUNDS = [59, 23, 31, 12, 6] as const

/** The lower bound that pairs with each field's upper bound. */
const FIELD_MINIMUMS = [0, 0, 1, 1, 0] as const

/** One field's bound, never undefined for the five legal positions. */
function bound(position: number, bounds: readonly number[]): number {
  const value = bounds[position]
  if (value === undefined) throw new CronError(`invalid field position ${position}`)
  return value
}

/** Day 7 is Sunday, exactly like day 0. */
function normalizeDayOfWeek(day: number): number {
  return day === 7 ? 0 : day
}

/**
 * Parse one field into its membership set.
 * @param field - the raw field text.
 * @param position - 0=minute 1=hour 2=dom 3=month 4=dow.
 * @returns the matching values.
 */
function parseField(field: string, position: number): ReadonlySet<number> {
  const minimum = bound(position, FIELD_MINIMUMS)
  const maximum = bound(position, FIELD_BOUNDS)
  const values = new Set<number>()
  for (const part of field.split(',')) {
    const slash = part.indexOf('/')
    const rangeText = slash === -1 ? part : part.slice(0, slash)
    const stepText = slash === -1 ? undefined : part.slice(slash + 1)
    const step = stepText === undefined ? 1 : Number(stepText)
    if (stepText !== undefined && (!/^\d+$/.test(stepText) || step < 1)) {
      throw new CronError(`invalid step "${stepText}" in cron field "${field}"`)
    }
    let from: number
    let to: number
    if (rangeText === '*') {
      from = minimum
      to = maximum
    } else {
      const dash = rangeText.indexOf('-')
      const lowText = dash === -1 ? rangeText : rangeText.slice(0, dash)
      const highText = dash === -1 ? rangeText : rangeText.slice(dash + 1)
      if (!/^\d+$/.test(lowText) || (dash !== -1 && !/^\d+$/.test(highText))) {
        throw new CronError(`invalid value "${rangeText}" in cron field "${field}"`)
      }
      from = Number(lowText)
      to = dash === -1 ? from : Number(highText)
      if (from > to) {
        throw new CronError(`descending range "${rangeText}" in cron field "${field}"`)
      }
    }
    for (let raw = from; raw <= to; raw += step) {
      // Day 7 normalizes to Sunday 0 before the bounds check admits it.
      const value = position === 4 ? normalizeDayOfWeek(raw) : raw
      if (value < minimum || value > maximum) {
        throw new CronError(`value ${raw} out of ${minimum}-${maximum} in cron field "${field}"`)
      }
      values.add(value)
    }
  }
  return values
}

/**
 * Parse a five-field cron expression.
 * @param expression - five whitespace-separated fields, numbers only.
 * @returns the membership sets.
 * @throws {@link CronError} on any malformed field or field count.
 */
export function parseCron(expression: string): CronFields {
  const fields = expression.trim().split(/\s+/)
  if (fields.length !== 5) {
    throw new CronError(`cron expression must have 5 fields, got ${fields.length}: "${expression}"`)
  }
  return {
    minute: parseField(fields[0] ?? '', 0),
    hour: parseField(fields[1] ?? '', 1),
    dayOfMonth: parseField(fields[2] ?? '', 2),
    month: parseField(fields[3] ?? '', 3),
    dayOfWeek: parseField(fields[4] ?? '', 4),
  }
}

/** Whether one set covers its whole domain (i.e. the field was unrestricted). */
function isFullSet(set: ReadonlySet<number>, position: number): boolean {
  return set.size === bound(position, FIELD_BOUNDS) - bound(position, FIELD_MINIMUMS) + 1
}

/**
 * Whether one local-time minute matches the expression (Vixie day rule).
 * @param fields - parsed membership sets.
 * @param at - the instant to test; its local minute is the candidate.
 * @returns true when the expression fires at that minute.
 */
export function cronMatches(fields: CronFields, at: Date): boolean {
  if (!fields.minute.has(at.getMinutes())) return false
  if (!fields.hour.has(at.getHours())) return false
  if (!fields.month.has(at.getMonth() + 1)) return false
  const domRestricted = !isFullSet(fields.dayOfMonth, 2)
  const dowRestricted = !isFullSet(fields.dayOfWeek, 4)
  const domMatches = fields.dayOfMonth.has(at.getDate())
  // getDay(): 0=Sunday, matching the normalized cron day-of-week domain.
  const dowMatches = fields.dayOfWeek.has(at.getDay())
  if (domRestricted && dowRestricted) return domMatches || dowMatches
  if (domRestricted) return domMatches
  if (dowRestricted) return dowMatches
  return true
}

/** The search horizon for the next match: one non-leap-plus year of minutes. */
const MAX_SEARCH_MINUTES = 367 * 24 * 60

/**
 * The next matching minute strictly after `from`, local time.
 * @param fields - parsed membership sets.
 * @param from - the search starts at the minute after this instant.
 * @returns the next matching minute, with seconds and below zeroed.
 * @throws {@link CronError} when nothing matches within a year (e.g. Feb 30).
 */
export function nextCronTime(fields: CronFields, from: Date): Date {
  const candidate = new Date(from)
  candidate.setSeconds(0, 0)
  candidate.setMinutes(candidate.getMinutes() + 1)
  for (let offset = 0; offset < MAX_SEARCH_MINUTES; offset += 1) {
    if (cronMatches(fields, candidate)) return new Date(candidate)
    candidate.setMinutes(candidate.getMinutes() + 1)
  }
  throw new CronError('cron expression matches no time within a year')
}
