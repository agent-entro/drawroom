/**
 * ChatPanel component tests.
 * Tests rendering, input handling, send, and collapse behaviour.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ChatPanel from '../ChatPanel.tsx';
import type { ChatMsgView } from '../../hooks/useYjsChat.ts';

const noop = () => {};

const SAMPLE_MSGS: ChatMsgView[] = [
  {
    id: 'msg-1',
    content: 'Hello there',
    type: 'message',
    participantId: 'p-1',
    displayName: 'Alice',
    color: '#4A90D9',
    canvasX: null,
    canvasY: null,
    createdAt: '2026-01-01T10:00:00.000Z',
  },
  {
    id: 'msg-2',
    content: 'Hi!',
    type: 'message',
    participantId: 'p-2',
    displayName: 'Bob',
    color: '#E67E22',
    canvasX: null,
    canvasY: null,
    createdAt: '2026-01-01T10:00:05.000Z',
  },
];

describe('ChatPanel', () => {
  it('renders messages', () => {
    render(
      <ChatPanel
        messages={SAMPLE_MSGS}
        typingNames={[]}
        sendMessage={noop}
        setTyping={noop}
        isConnected={true}
        participantId="p-1"
      />,
    );
    expect(screen.getByText('Hello there')).toBeInTheDocument();
    expect(screen.getByText('Hi!')).toBeInTheDocument();
  });

  it('shows "You" for own messages', () => {
    render(
      <ChatPanel
        messages={SAMPLE_MSGS}
        typingNames={[]}
        sendMessage={noop}
        setTyping={noop}
        isConnected={true}
        participantId="p-1"
      />,
    );
    expect(screen.getByText('You')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('shows empty state when no messages', () => {
    render(
      <ChatPanel
        messages={[]}
        typingNames={[]}
        sendMessage={noop}
        setTyping={noop}
        isConnected={true}
      />,
    );
    expect(screen.getByText(/No messages yet/)).toBeInTheDocument();
  });

  it('calls sendMessage on Enter key', () => {
    const sendMessage = vi.fn();
    render(
      <ChatPanel
        messages={[]}
        typingNames={[]}
        sendMessage={sendMessage}
        setTyping={noop}
        isConnected={true}
      />,
    );

    const input = screen.getByRole('textbox', { name: /chat message input/i });
    fireEvent.change(input, { target: { value: 'Test message' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(sendMessage).toHaveBeenCalledWith('Test message');
  });

  it('does NOT send on Shift+Enter', () => {
    const sendMessage = vi.fn();
    render(
      <ChatPanel
        messages={[]}
        typingNames={[]}
        sendMessage={sendMessage}
        setTyping={noop}
        isConnected={true}
      />,
    );

    const input = screen.getByRole('textbox', { name: /chat message input/i });
    fireEvent.change(input, { target: { value: 'Multiline' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });

    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('clears input after send', () => {
    render(
      <ChatPanel
        messages={[]}
        typingNames={[]}
        sendMessage={noop}
        setTyping={noop}
        isConnected={true}
      />,
    );

    const input = screen.getByRole('textbox', { name: /chat message input/i }) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'Hello' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(input.value).toBe('');
  });

  it('disables input when not connected', () => {
    render(
      <ChatPanel
        messages={[]}
        typingNames={[]}
        sendMessage={noop}
        setTyping={noop}
        isConnected={false}
      />,
    );

    const input = screen.getByRole('textbox', { name: /chat message input/i });
    expect(input).toBeDisabled();
  });

  it('shows typing indicator', () => {
    render(
      <ChatPanel
        messages={[]}
        typingNames={['Alice']}
        sendMessage={noop}
        setTyping={noop}
        isConnected={true}
      />,
    );
    expect(screen.getByText('Alice is typing…')).toBeInTheDocument();
  });

  it('shows multi-user typing indicator', () => {
    render(
      <ChatPanel
        messages={[]}
        typingNames={['Alice', 'Bob']}
        sendMessage={noop}
        setTyping={noop}
        isConnected={true}
      />,
    );
    expect(screen.getByText('Alice and Bob are typing…')).toBeInTheDocument();
  });

  it('collapses and expands', () => {
    render(
      <ChatPanel
        messages={[]}
        typingNames={[]}
        sendMessage={noop}
        setTyping={noop}
        isConnected={true}
      />,
    );

    // Panel starts expanded — chat heading visible
    expect(screen.getByText('Chat')).toBeInTheDocument();

    // Click collapse button
    const collapseBtn = screen.getByRole('button', { name: /collapse chat/i });
    fireEvent.click(collapseBtn);

    // Now in collapsed state
    expect(screen.queryByText('Chat')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open chat/i })).toBeInTheDocument();

    // Expand again
    fireEvent.click(screen.getByRole('button', { name: /open chat/i }));
    expect(screen.getByText('Chat')).toBeInTheDocument();
  });

  it('renders system messages differently', () => {
    const systemMsg: ChatMsgView = {
      id: 'sys-1',
      content: 'Alice joined the room',
      type: 'system',
      participantId: 'p-1',
      displayName: 'System',
      color: '#888',
      canvasX: null,
      canvasY: null,
      createdAt: '2026-01-01T10:00:00.000Z',
    };
    render(
      <ChatPanel
        messages={[systemMsg]}
        typingNames={[]}
        sendMessage={noop}
        setTyping={noop}
        isConnected={true}
      />,
    );
    expect(screen.getByText('Alice joined the room')).toBeInTheDocument();
  });

  it('badges comment-type messages with pin icon', () => {
    const commentMsg: ChatMsgView = {
      id: 'cmt-1',
      content: 'Check this out',
      type: 'comment',
      participantId: 'p-2',
      displayName: 'Bob',
      color: '#E67E22',
      canvasX: 100,
      canvasY: 200,
      createdAt: '2026-01-01T10:00:00.000Z',
    };
    render(
      <ChatPanel
        messages={[commentMsg]}
        typingNames={[]}
        sendMessage={noop}
        setTyping={noop}
        isConnected={true}
        participantId="p-1"
      />,
    );
    expect(screen.getByText('📍')).toBeInTheDocument();
  });
});
