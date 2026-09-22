import { describe, expect, it } from 'vitest'
import { CronError, cronMatches, nextCronTime, parseCron } from '../src/cron.ts'

describe('parseCron', () => {
  it('parses every minute', () => {
    expect(parseCron('* * * * *').minute.size).toBe(60)
  })

  it('parses lists, ranges, and steps', () => {
    const fields = parseCron('5,10-12 0-23/2 */5 1 1-3')
    expect([...fields.minute]).toEqual([5, 10, 11, 12])
    expect([...fields.hour]).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22])
    // Star-step starts at the domain minimum: 1, 6, 11, ... for dom.
    expect([...fields.dayOfMonth]).toEqual([1, 6, 11, 16, 21, 26, 31])
    expect([...fields.month]).toEqual([1])
    expect([...fields.dayOfWeek]).toEqual([1, 2, 3])
  })

  it('normalizes day 7 to Sunday 0', () => {
    expect([...parseCron('0 0 * * 7').dayOfWeek]).toEqual([0])
  })

  it('rejects malformed expressions', () => {
    expect(() => parseCron('* * * *')).toThrow(CronError)
    expect(() => parseCron('60 * * * *')).toThrow(CronError)
    expect(() => parseCron('* 24 * * *')).toThrow(CronError)
    expect(() => parseCron('* * 0 * *')).toThrow(CronError)
    expect(() => parseCron('* * * 13 *')).toThrow(CronError)
    expect(() => parseCron('* * * * 8')).toThrow(CronError)
    expect(() => parseCron('*/0 * * * *')).toThrow(CronError)
    expect(() => parseCron('12-5 * * * *')).toThrow(CronError)
    expect(() => parseCron('a * * * *')).toThrow(CronError)
  })
})

describe('cronMatches', () => {
  it('matches an exact minute', () => {
    const fields = parseCron('30 4 * * *')
    expect(cronMatches(fields, new Date(2026, 8, 22, 4, 30))).toBe(true)
    expect(cronMatches(fields, new Date(2026, 8, 22, 4, 31))).toBe(false)
    expect(cronMatches(fields, new Date(2026, 8, 22, 5, 30))).toBe(false)
  })

  it('ORs the day fields when both are restricted (Vixie rule)', () => {
    // The 13th, or any Friday.
    const fields = parseCron('0 0 13 * 5')
    expect(cronMatches(fields, new Date(2026, 8, 13))).toBe(true) // a Sunday
    expect(cronMatches(fields, new Date(2026, 8, 18))).toBe(true) // a Friday
    expect(cronMatches(fields, new Date(2026, 8, 21))).toBe(false) // a Monday
  })

  it('filters only by the restricted day field', () => {
    const domOnly = parseCron('0 0 13 * *')
    expect(cronMatches(domOnly, new Date(2026, 8, 13))).toBe(true)
    const dowOnly = parseCron('0 0 * * 1')
    expect(cronMatches(dowOnly, new Date(2026, 8, 21))).toBe(true) // a Monday
    expect(cronMatches(dowOnly, new Date(2026, 8, 22))).toBe(false)
  })
})

describe('nextCronTime', () => {
  it('finds the next matching minute strictly after the instant', () => {
    const fields = parseCron('*/15 * * * *')
    const next = nextCronTime(fields, new Date(2026, 8, 22, 10, 7, 30))
    expect(next.getHours()).toBe(10)
    expect(next.getMinutes()).toBe(15)
    expect(next.getSeconds()).toBe(0)
  })

  it('rolls across hours and days', () => {
    const fields = parseCron('0 0 * * *')
    const next = nextCronTime(fields, new Date(2026, 8, 22, 0, 0, 1))
    expect(next.getDate()).toBe(23)
    expect(next.getHours()).toBe(0)
  })

  it('finds next month for a month-scoped expression', () => {
    const fields = parseCron('0 0 1 1 *')
    const next = nextCronTime(fields, new Date(2026, 8, 22))
    expect(next.getFullYear()).toBe(2027)
    expect(next.getMonth()).toBe(0)
    expect(next.getDate()).toBe(1)
  })

  it('rejects an impossible date within the horizon', () => {
    expect(() => nextCronTime(parseCron('0 0 30 2 *'), new Date(2026, 8, 22))).toThrow(CronError)
  })
})
