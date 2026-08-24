import { WEBAPP_SHORT_NAME } from '.'

export type HeaderPreferences = {
  poolMiners: boolean
  appMiners: boolean
  poolHashrate: boolean
  appHashrate: boolean
  consumption: boolean
  efficiency: boolean
}

export const DEFAULT_HEADER_PREFERENCES: HeaderPreferences = {
  poolMiners: true,
  appMiners: true,
  poolHashrate: true,
  appHashrate: true,
  consumption: true,
  efficiency: true,
}

export const HEADER_ITEMS = [
  { key: 'poolMiners' as keyof HeaderPreferences, label: 'Pool Miners' },
  { key: 'appMiners' as keyof HeaderPreferences, label: `${WEBAPP_SHORT_NAME} Miners` },
  { key: 'poolHashrate' as keyof HeaderPreferences, label: 'Pool Hashrate' },
  { key: 'appHashrate' as keyof HeaderPreferences, label: `${WEBAPP_SHORT_NAME} Hashrate` },
  { key: 'consumption' as keyof HeaderPreferences, label: 'Consumption' },
  { key: 'efficiency' as keyof HeaderPreferences, label: 'Efficiency' },
] as const

export const HEADER_PREFERENCES_STORAGE_KEY = 'headerControlsPreferences'

export const HEADER_PREFERENCES_EVENTS = {
  STORAGE: 'storage',
  PREFERENCES_CHANGED: 'headerPreferencesChanged',
} as const
