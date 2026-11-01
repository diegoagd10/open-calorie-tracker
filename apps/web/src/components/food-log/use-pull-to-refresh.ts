import { type RefObject, useEffect, useRef, useState } from 'react'

// How far the finger has to move down before releasing reloads.
export const PULL_THRESHOLD_PX = 80
// The screen moves less than the finger, so pulling feels like stretching.
const RESISTANCE = 0.5
// Where the screen rests while reloading, leaving room for the loader.
const REFRESHING_OFFSET_PX = 56
const SETTLE_TRANSITION = 'transform 200ms ease-out'
// How far the finger moves before the gesture counts as sideways, like a swipe through the weeks.
const AXIS_LOCK_PX = 6

// Pull to refresh for touch screens: dragging down from the top of the page moves `content` with
// the finger, and releasing past the threshold calls `onRefresh`. Mouse drags are ignored.
export const usePullToRefresh = (
  content: RefObject<HTMLElement | null>,
  onRefresh: () => Promise<void>,
) => {
  const [armed, setArmed] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const onRefreshRef = useRef(onRefresh)

  useEffect(() => {
    onRefreshRef.current = onRefresh
  }, [onRefresh])

  useEffect(() => {
    let startY: number | undefined
    let startX = 0
    let locked = false
    let distance = 0
    let busy = false

    // Set directly on the element, so the screen follows the finger without waiting for React.
    const moveContent = (offset: number, animate: boolean) => {
      const element = content.current
      if (element === null) return
      element.style.transition = animate ? SETTLE_TRANSITION : 'none'
      element.style.transform = offset > 0 ? `translateY(${offset}px)` : ''
    }

    const onTouchStart = (event: TouchEvent) => {
      const touch = event.touches[0]
      if (busy || window.scrollY > 0 || event.touches.length !== 1 || touch === undefined) return
      startY = touch.clientY
      startX = touch.clientX
      locked = false
      distance = 0
    }

    const onTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0]
      if (startY === undefined || touch === undefined) return
      const across = Math.abs(touch.clientX - startX)
      const down = Math.abs(touch.clientY - startY)
      if (!locked && Math.max(across, down) > AXIS_LOCK_PX) {
        locked = true
        // A sideways gesture is not a pull.
        if (across > down) {
          startY = undefined
          setArmed(false)
          moveContent(0, true)
          return
        }
      }
      distance = Math.max(0, touch.clientY - startY)
      // Moving up scrolls the page as usual.
      if (distance === 0) return
      event.preventDefault()
      moveContent(distance * RESISTANCE, false)
      setArmed(distance >= PULL_THRESHOLD_PX)
    }

    const onTouchEnd = async () => {
      if (startY === undefined) return
      startY = undefined
      if (distance < PULL_THRESHOLD_PX) {
        setArmed(false)
        moveContent(0, true)
        return
      }

      busy = true
      setRefreshing(true)
      moveContent(REFRESHING_OFFSET_PX, true)
      try {
        await onRefreshRef.current()
      } finally {
        busy = false
        setArmed(false)
        setRefreshing(false)
        moveContent(0, true)
      }
    }

    const handleTouchEnd = () => void onTouchEnd()
    // A cancelled gesture (e.g. the browser took over) never reloads.
    const handleTouchCancel = () => {
      distance = 0
      void onTouchEnd()
    }

    window.addEventListener('touchstart', onTouchStart, { passive: true })
    // Not passive, so the browser does not scroll or overscroll while pulling.
    window.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('touchend', handleTouchEnd)
    window.addEventListener('touchcancel', handleTouchCancel)
    return () => {
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', handleTouchEnd)
      window.removeEventListener('touchcancel', handleTouchCancel)
    }
  }, [content])

  // The loader shows once the pull would reload, and while reloading.
  return { showLoader: armed || refreshing }
}
