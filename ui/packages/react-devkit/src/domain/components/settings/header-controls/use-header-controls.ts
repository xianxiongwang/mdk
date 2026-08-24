import { useLocalStorage } from '@tetherto/mdk-react-adapter'

import {
  DEFAULT_HEADER_PREFERENCES,
  HEADER_PREFERENCES_STORAGE_KEY,
} from '../../../constants/header-controls.constants'
import type { HeaderPreferences } from '../../../constants/header-controls.constants'
import { useNotification } from '../../../utils/use-notification'

/**
 * Read/write hook for the global header-controls store (toggles, sticky flag, theme).
 *
 * @category settings
 * @domain device-management
 * @kernelCapability device-management
 * @tier agent-ready
 */
export const useHeaderControls = () => {
  const { notifySuccess } = useNotification()
  const [storedPreferences, setPreferences] = useLocalStorage<HeaderPreferences>(
    HEADER_PREFERENCES_STORAGE_KEY,
    DEFAULT_HEADER_PREFERENCES,
  )
  /* Stored entries may predate newly added (or renamed) preference keys —
   * merge over the defaults so missing keys fall back instead of reading
   * as `undefined` (which would render every affected toggle as off). */
  const preferences = { ...DEFAULT_HEADER_PREFERENCES, ...storedPreferences }

  const handleToggle = (key: keyof HeaderPreferences, value: boolean) => {
    setPreferences({ ...preferences, [key]: value })
    notifySuccess('Header preference updated', '')
  }

  const handleReset = () => {
    setPreferences(DEFAULT_HEADER_PREFERENCES)
    notifySuccess('Header preferences reset to default', '')
  }

  return {
    preferences,
    isLoading: false,
    error: null,
    handleToggle,
    handleReset,
  }
}
