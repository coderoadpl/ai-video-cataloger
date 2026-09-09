import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';

import { SavedToastProvider as Scope, useSavedMessage, useSavedToast } from './SavedToastProvider.js';

const Notification = () => {
  const { message } = useSavedMessage();
  const show = useSavedToast();
  return <><button onClick={() => show('Stored')}>Save</button><output>{message}</output></>;
};

it('keeps saved notifications local to their mounted shell', () => {
  render(<><section aria-label="first"><Scope><Notification /></Scope></section><section aria-label="second"><Scope><Notification /></Scope></section></>);
  fireEvent.click(within(screen.getByRole('region', { name: 'first' })).getByText('Save'));
  expect(within(screen.getByRole('region', { name: 'first' })).getByRole('status').textContent).toBe('Stored');
  expect(within(screen.getByRole('region', { name: 'second' })).getByRole('status').textContent).toBe('');
});
