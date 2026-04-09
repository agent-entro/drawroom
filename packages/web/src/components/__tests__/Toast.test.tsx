/**
 * Tests for the Toast notification system.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ToastProvider, useToast } from '../Toast.tsx';

// A helper component that calls toast API methods
function ToastTrigger({ onMount }: { onMount: (api: ReturnType<typeof useToast>['toast']) => void }) {
  const { toast } = useToast();
  // Call onMount so tests can trigger toasts imperatively
  void (onMount(toast));
  return null;
}

function renderWithProvider(onMount: (toast: ReturnType<typeof useToast>['toast']) => void) {
  return render(
    <ToastProvider>
      <ToastTrigger onMount={onMount} />
    </ToastProvider>,
  );
}

describe('ToastProvider + useToast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('throws if useToast is used outside ToastProvider', () => {
    const BadComponent = () => {
      useToast();
      return null;
    };
    expect(() => render(<BadComponent />)).toThrow('useToast must be used within a <ToastProvider>');
  });

  it('shows a success toast', () => {
    let capturedToast!: ReturnType<typeof useToast>['toast'];
    render(
      <ToastProvider>
        <ToastTrigger onMount={(t) => { capturedToast = t; }} />
      </ToastProvider>,
    );

    act(() => {
      capturedToast.success('Saved successfully!');
    });

    expect(screen.getByText('Saved successfully!')).toBeTruthy();
  });

  it('shows an error toast', () => {
    let capturedToast!: ReturnType<typeof useToast>['toast'];
    render(
      <ToastProvider>
        <ToastTrigger onMount={(t) => { capturedToast = t; }} />
      </ToastProvider>,
    );

    act(() => {
      capturedToast.error('Something broke!');
    });

    expect(screen.getByText('Something broke!')).toBeTruthy();
  });

  it('dismisses a toast when the × button is clicked', () => {
    let capturedToast!: ReturnType<typeof useToast>['toast'];
    render(
      <ToastProvider>
        <ToastTrigger onMount={(t) => { capturedToast = t; }} />
      </ToastProvider>,
    );

    act(() => {
      capturedToast.info('Click to close me');
    });
    expect(screen.getByText('Click to close me')).toBeTruthy();

    const dismissBtn = screen.getByRole('button', { name: /dismiss/i });
    fireEvent.click(dismissBtn);

    // After the fade-out transition (300ms)
    act(() => {
      vi.advanceTimersByTime(400);
    });

    expect(screen.queryByText('Click to close me')).toBeNull();
  });

  it('auto-dismisses after the specified duration', () => {
    let capturedToast!: ReturnType<typeof useToast>['toast'];
    render(
      <ToastProvider>
        <ToastTrigger onMount={(t) => { capturedToast = t; }} />
      </ToastProvider>,
    );

    act(() => {
      capturedToast.warning('Auto-dismiss me', 2000);
    });

    expect(screen.getByText('Auto-dismiss me')).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(2500); // past duration + fade
    });

    expect(screen.queryByText('Auto-dismiss me')).toBeNull();
  });

  it('sticky toast (duration=0) does not auto-dismiss', () => {
    let capturedToast!: ReturnType<typeof useToast>['toast'];
    render(
      <ToastProvider>
        <ToastTrigger onMount={(t) => { capturedToast = t; }} />
      </ToastProvider>,
    );

    act(() => {
      capturedToast.error('Sticky error', 0);
    });

    act(() => {
      vi.advanceTimersByTime(30_000);
    });

    expect(screen.getByText('Sticky error')).toBeTruthy();
  });
});
