'use client'

import { Component, type ReactNode } from 'react'

/**
 * Keeps one broken section from taking the whole tool down.
 *
 * There is no boundary above this in the app, so an uncaught render error
 * unmounts the entire tree: the rep gets a blank page rather than a broken
 * panel, and it throws again on the next lead they open. Wrapping a section
 * turns that into a line of text where the section would have been.
 *
 * Only catches errors thrown during render. Failures inside an async fetch are
 * already handled where the fetch happens.
 */
export default class ErrorBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown, info: unknown) {
    console.error('[ui] section crashed:', error, info)
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}
