import type { ProctorEvent } from './exam-model.ts';

type ObservedDocument = Pick<
  Document,
  | 'visibilityState'
  | 'fullscreenElement'
  | 'addEventListener'
  | 'removeEventListener'
>;

// Observe transitions, not window blur: native dialogs or browser UI may
// take focus without the exam page becoming hidden.
export function observeExamDocument(
  target: ObservedDocument,
  onEvent: (type: ProctorEvent) => void,
  onFullscreen: (active: boolean) => void,
) {
  let visibility = target.visibilityState;
  let fullscreen = !!target.fullscreenElement;
  function visibilityChanged() {
    const next = target.visibilityState;
    if (visibility !== 'hidden' && next === 'hidden') onEvent('TAB_BLUR');
    visibility = next;
  }
  function fullscreenChanged() {
    const next = !!target.fullscreenElement;
    if (fullscreen && !next) onEvent('FULLSCREEN_EXIT');
    fullscreen = next;
    onFullscreen(next);
  }
  target.addEventListener('visibilitychange', visibilityChanged);
  target.addEventListener('fullscreenchange', fullscreenChanged);
  return () => {
    target.removeEventListener('visibilitychange', visibilityChanged);
    target.removeEventListener('fullscreenchange', fullscreenChanged);
  };
}
