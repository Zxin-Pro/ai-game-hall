import { create } from 'zustand';

/* ------------------------------------------------------------------ */
/* 联网状态：后端连不上就切离线演示模式                                   */
/* ------------------------------------------------------------------ */

interface NetState {
  /** true = 后端连不上，正在用本地演示数据 */
  offline: boolean;
  /** 曾经连上过，后来断了 */
  everConnected: boolean;
  lastError: string | null;
  setOnline: () => void;
  setOffline: (err?: string) => void;
}

export const useNet = create<NetState>((set, get) => ({
  offline: false,
  everConnected: false,
  lastError: null,
  setOnline: () => {
    if (!get().offline && get().everConnected) return;
    set({ offline: false, everConnected: true, lastError: null });
  },
  setOffline: (err) => set({ offline: true, lastError: err ?? null }),
}));
