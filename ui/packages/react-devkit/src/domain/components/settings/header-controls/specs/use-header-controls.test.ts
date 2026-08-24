import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_HEADER_PREFERENCES } from '@domain/constants/header-controls.constants'

import { useHeaderControls } from '../use-header-controls'

const mockNotifySuccess = vi.fn()
vi.mock('@domain/utils/use-notification', () => ({
  useNotification: () => ({
    notifySuccess: mockNotifySuccess,
    notifyError: vi.fn(),
    notifyInfo: vi.fn(),
    notifyWarning: vi.fn(),
  }),
}))

describe('useHeaderControls', () => {
  beforeEach(() => {
    localStorage.clear()
    mockNotifySuccess.mockClear()
  })

  it('returns default preferences when localStorage is empty', () => {
    const { result } = renderHook(() => useHeaderControls())
    expect(result.current.preferences).toEqual(DEFAULT_HEADER_PREFERENCES)
    expect(result.current.isLoading).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('loads preferences from localStorage on mount', () => {
    const stored = {
      poolMiners: false,
      appMiners: true,
      poolHashrate: true,
      appHashrate: false,
      consumption: true,
      efficiency: false,
    }
    localStorage.setItem('headerControlsPreferences', JSON.stringify(stored))
    const { result } = renderHook(() => useHeaderControls())
    expect(result.current.preferences.poolMiners).toBe(false)
    expect(result.current.preferences.appMiners).toBe(true)
  })

  it('merges stored entries missing newer keys over the defaults', () => {
    // Simulates a stored entry written before the mos* -> app* key rename.
    const stored = {
      poolMiners: false,
      poolHashrate: true,
      consumption: true,
      efficiency: false,
    }
    localStorage.setItem('headerControlsPreferences', JSON.stringify(stored))
    const { result } = renderHook(() => useHeaderControls())
    expect(result.current.preferences.appMiners).toBe(DEFAULT_HEADER_PREFERENCES.appMiners)
    expect(result.current.preferences.appHashrate).toBe(DEFAULT_HEADER_PREFERENCES.appHashrate)
    expect(result.current.preferences.poolMiners).toBe(false)
  })

  it('handleToggle updates a preference and saves to localStorage', () => {
    const { result } = renderHook(() => useHeaderControls())
    act(() => {
      result.current.handleToggle('poolMiners', false)
    })
    expect(result.current.preferences.poolMiners).toBe(false)
    expect(mockNotifySuccess).toHaveBeenCalledWith('Header preference updated', '')
    const stored = JSON.parse(localStorage.getItem('headerControlsPreferences') ?? '{}')
    expect(stored.poolMiners).toBe(false)
  })

  it('handleReset resets preferences to defaults', () => {
    const { result } = renderHook(() => useHeaderControls())
    act(() => {
      result.current.handleToggle('poolMiners', false)
    })
    act(() => {
      result.current.handleReset()
    })
    expect(result.current.preferences).toEqual(DEFAULT_HEADER_PREFERENCES)
    expect(mockNotifySuccess).toHaveBeenCalledWith('Header preferences reset to default', '')
  })

  it('falls back to defaults when localStorage contains invalid JSON', () => {
    localStorage.setItem('headerControlsPreferences', 'invalid-json')
    const { result } = renderHook(() => useHeaderControls())
    expect(result.current.preferences).toEqual(DEFAULT_HEADER_PREFERENCES)
  })
})
