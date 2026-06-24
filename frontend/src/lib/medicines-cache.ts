"use client";

import useSWR, { mutate } from "swr";
import { api } from "./api";

export interface CachedMedicine {
  id: string;
  medicineName: string;
  genericName?: string | null;
  dosageForm?: string | null;
  dosageFormOther?: string | null;
  strength?: string | null;
  unitType?: string;
  reorderThreshold: number;
  leadTimeDays?: number | null;
  minimumOrderLevel?: number | null;
  categoryId?: string | null;
  category?: {
    id: string;
    name: string;
    coldStorage?: boolean;
    controlledDrug?: boolean;
    requiresPrescription?: boolean;
  } | null;
  strengths?: { id: string; strength: string; isActive?: boolean; sortOrder?: number }[];
  isActive?: boolean;
}

const MEDICINES_KEY = "/medicines";

export function useMedicines() {
  return useSWR<CachedMedicine[]>(
    MEDICINES_KEY,
    () => api<CachedMedicine[]>(MEDICINES_KEY),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      dedupingInterval: 5 * 60 * 1000,
    }
  );
}

export function invalidateMedicinesCache(): void {
  mutate(MEDICINES_KEY);
}
