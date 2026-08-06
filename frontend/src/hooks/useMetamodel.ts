import { useState, useEffect } from "react";
import { api } from "@/api/client";
import type { CardType, RelationType } from "@/types";

type Snapshot = { types: CardType[]; relationTypes: RelationType[] };
type Subscriber = (snap: Snapshot) => void;

let _cache: Snapshot | null = null;
let _inflight: Promise<Snapshot> | null = null;
let _generation = 0; // incremented on every new fetch; guards stale .then writes
const _subscribers: Set<Subscriber> = new Set();

async function _fetch(): Promise<Snapshot> {
  const [t, r] = await Promise.all([
    api.get<CardType[]>("/metamodel/types"),
    api.get<RelationType[]>("/metamodel/relation-types"),
  ]);
  return { types: t, relationTypes: r };
}

function _fetchOnce(): Promise<Snapshot> {
  if (_cache) return Promise.resolve(_cache);
  if (_inflight) return _inflight;
  const gen = ++_generation;
  _inflight = _fetch()
    .then((snap) => {
      // Only write to _cache if no newer fetch has started since this one.
      // Without this guard an orphaned fetch (nulled from invalidateCache before
      // it resolved) could overwrite a fresher cache written by the new fetch.
      if (_generation === gen) _cache = snap;
      return snap;
    })
    .finally(() => {
      _inflight = null;
    });
  return _inflight;
}

export function useMetamodel() {
  const [types, setTypes] = useState<CardType[]>(_cache?.types || []);
  const [relationTypes, setRelationTypes] = useState<RelationType[]>(_cache?.relationTypes || []);
  const [loading, setLoading] = useState(!_cache);

  useEffect(() => {
    let cancelled = false;
    const sub: Subscriber = (snap) => {
      if (cancelled) return;
      setTypes(snap.types);
      setRelationTypes(snap.relationTypes);
    };
    _subscribers.add(sub);
    if (!_cache) {
      _fetchOnce()
        .then(sub)
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }
    return () => {
      cancelled = true;
      _subscribers.delete(sub);
    };
  }, []);

  const getType = (key: string) => types.find((t) => t.key === key);

  const getRelationsForType = (typeKey: string) =>
    relationTypes.filter(
      (r) => r.source_type_key === typeKey || r.target_type_key === typeKey,
    );

  return { types, relationTypes, loading, getType, getRelationsForType, invalidateCache };
}

/**
 * Drop the cached metamodel snapshot, re-fetch immediately, and broadcast the
 * fresh snapshot to every mounted `useMetamodel` consumer.
 *
 * Without the broadcast, callers that mutate the metamodel from another tab —
 * MetamodelAdmin saving a new type, MigrationAdmin applying a snapshot that
 * lands custom card / relation types — would only refresh components that
 * remount after the call. Sidebars and dialogs already mounted (Inventory's
 * filter panel was the bug report) would silently keep showing the stale
 * built-in list until a hard refresh.
 *
 * Module-level export (not a hook method) so non-React callers and one-off
 * post-mutation hooks can reach it without first calling `useMetamodel()` in
 * a render-only context.
 */
export async function invalidateCache(): Promise<void> {
  // Bump generation first so any currently in-flight fetch's .then closure
  // will see a generation mismatch and skip writing to _cache.
  _generation++;
  _cache = null;
  _inflight = null;
  const snap = await _fetchOnce();
  for (const sub of _subscribers) sub(snap);
}
