import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { IntentBar } from './intent-bar';

async function show(props: Partial<Parameters<typeof IntentBar>[0]> = {}) {
  const onSubmit = jest.fn();
  await render(
    <IntentBar highlighted={false} mode="start" onChangeText={jest.fn()} onSubmit={onSubmit} value="" {...props} />,
  );
  return onSubmit;
}

describe('IntentBar', () => {
  it('does nothing when submitted empty', async () => {
    const onSubmit = await show();
    expect(screen.getByPlaceholderText('Ask Dera')).toBeOnTheScreen();
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Plan' }));
      fireEvent(screen.getByLabelText('Wallet intent'), 'submitEditing');
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits a sentence from the button or the keyboard', async () => {
    const onSubmit = await show({ value: 'send 0.01 eth to alice' });
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Plan' }));
      fireEvent(screen.getByLabelText('Wallet intent'), 'submitEditing');
    });
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  it('is read-only with a busy button while planning', async () => {
    const onSubmit = await show({ mode: 'planning', value: 'send 0.01 eth to alice' });
    expect(screen.getByLabelText('Wallet intent').props.editable).toBe(false);
    expect(screen.getByText('…')).toBeOnTheScreen();
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Planning' }));
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('prompts for replies and follow-ups', async () => {
    await show({ mode: 'reply' });
    expect(screen.getByPlaceholderText('Reply here')).toBeOnTheScreen();
  });
});
