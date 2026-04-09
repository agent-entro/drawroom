/**
 * Tests for the ErrorBoundary component.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import ErrorBoundary from '../ErrorBoundary.tsx';

// Suppress React's console.error for caught errors during tests
const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

afterEach(() => {
  consoleError.mockClear();
});

// A component that throws on demand
function Thrower({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error('Test render error');
  return <div>OK</div>;
}

describe('ErrorBoundary', () => {
  it('renders children when no error occurs', () => {
    render(
      <ErrorBoundary>
        <Thrower shouldThrow={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText('OK')).toBeTruthy();
  });

  it('renders default fallback UI when a child throws', () => {
    render(
      <ErrorBoundary>
        <Thrower shouldThrow={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByText(/something went wrong/i)).toBeTruthy();
    expect(screen.getByText(/Test render error/i)).toBeTruthy();
  });

  it('renders custom fallback if provided', () => {
    render(
      <ErrorBoundary fallback={<div>Custom fallback</div>}>
        <Thrower shouldThrow={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Custom fallback')).toBeTruthy();
  });

  it('calls onError prop when an error is caught', () => {
    const onError = vi.fn();
    render(
      <ErrorBoundary onError={onError}>
        <Thrower shouldThrow={true} />
      </ErrorBoundary>,
    );
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]![0]).toBeInstanceOf(Error);
    expect((onError.mock.calls[0]![0] as Error).message).toBe('Test render error');
  });

  it('resets when "Try again" is clicked', () => {
    // Use a stateful wrapper so we can change `shouldThrow` without re-mounting ErrorBoundary
    let setShouldThrow!: (v: boolean) => void;
    function Wrapper() {
      const [shouldThrow, setLocal] = React.useState(true);
      setShouldThrow = setLocal;
      return (
        <ErrorBoundary>
          <Thrower shouldThrow={shouldThrow} />
        </ErrorBoundary>
      );
    }

    render(<Wrapper />);
    expect(screen.getByText(/something went wrong/i)).toBeTruthy();

    // Allow child to not throw on next render, THEN reset the boundary
    act(() => setShouldThrow(false));
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));

    expect(screen.getByText('OK')).toBeTruthy();
  });
});
