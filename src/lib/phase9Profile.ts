type Phase9Window = Window & {
  __PARTFLOW_PHASE9_PROFILE__?: boolean;
};

export function phase9Mark(name: string, detail?: Record<string, unknown>): void {
  if (!(window as Phase9Window).__PARTFLOW_PHASE9_PROFILE__) return;
  performance.mark(`partflow:${name}`, detail === undefined ? undefined : { detail });
}
