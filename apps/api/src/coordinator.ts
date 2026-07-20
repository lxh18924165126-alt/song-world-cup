import {
  DraftAccessError,
} from "./drafts";
import {
  TournamentAccessError,
  TournamentConflictError,
  TournamentValidationError,
  lockCurrentTournamentRound,
  pickTournamentMatch,
  syncTournamentEvents,
  type LockRoundInput,
  type PickTournamentInput,
  type SyncTournamentEventsInput,
  type TournamentPayload,
} from "./tournaments";
import {
  acquireEditLease,
  takeoverEditLease,
  type EditLeaseRecord,
  type EditLeaseStatus,
} from "./lease";

export interface CoordinatorEnv {
  DB: D1Database;
}

export type CoordinatorMutationResult =
  | { ok: true; payload: TournamentPayload; lease: EditLeaseStatus }
  | { ok: false; status: number; code: string; message: string; lease?: EditLeaseStatus };

export type CoordinatorLeaseResult =
  | { ok: true; lease: EditLeaseStatus }
  | { ok: false; status: number; code: string; message: string };

type CoordinatorRequest =
  | { action: "acquire"; deviceId: string }
  | { action: "takeover"; deviceId: string }
  | {
    action: "pick";
    deviceId: string;
    tournamentId: string;
    token: string;
    input: PickTournamentInput;
  }
  | {
    action: "lockRound";
    deviceId: string;
    tournamentId: string;
    token: string;
    input: LockRoundInput;
  }
  | {
    action: "events";
    deviceId: string;
    tournamentId: string;
    token: string;
    input: SyncTournamentEventsInput;
  };

export class TournamentCoordinator implements DurableObject {

  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: CoordinatorEnv,
  ) {}

  async fetch(request: Request): Promise<Response> {
    try {
      const input = await request.json<CoordinatorRequest>();
      if (input.action === "acquire") {
        const lease = await this.acquire(input.deviceId);
        return Response.json({ ok: true, lease } satisfies CoordinatorLeaseResult);
      }
      if (input.action === "takeover") {
        const lease = await this.takeover(input.deviceId);
        return Response.json({ ok: true, lease } satisfies CoordinatorLeaseResult);
      }
      if (input.action === "pick") {
        return Response.json(await this.pick(
          input.deviceId,
          input.tournamentId,
          input.token,
          input.input,
        ));
      }
      if (input.action === "lockRound") {
        return Response.json(await this.lockRound(
          input.deviceId,
          input.tournamentId,
          input.token,
          input.input,
        ));
      }
      return Response.json(await this.events(
        input.deviceId,
        input.tournamentId,
        input.token,
        input.input,
      ));
    } catch (error) {
      return Response.json({
        ok: false,
        status: 400,
        code: "invalid_coordinator_request",
        message: error instanceof Error ? error.message : "协调请求无效",
      } satisfies CoordinatorLeaseResult);
    }
  }

  async acquire(deviceId: string): Promise<EditLeaseStatus> {
    const current = await this.ctx.storage.get<EditLeaseRecord>("lease");
    const decision = acquireEditLease(current, deviceId, Date.now());
    if (decision.changed) await this.ctx.storage.put("lease", decision.record);
    return decision.status;
  }

  async takeover(deviceId: string): Promise<EditLeaseStatus> {
    const current = await this.ctx.storage.get<EditLeaseRecord>("lease");
    const decision = takeoverEditLease(current, deviceId, Date.now());
    if (decision.changed) await this.ctx.storage.put("lease", decision.record);
    return decision.status;
  }

  async pick(
    deviceId: string,
    tournamentId: string,
    token: string,
    input: PickTournamentInput,
  ): Promise<CoordinatorMutationResult> {
    const lease = await this.acquire(deviceId);
    if (!lease.editable) return leaseDenied(lease);
    try {
      return {
        ok: true,
        payload: await pickTournamentMatch(this.env.DB, tournamentId, token, input),
        lease,
      };
    } catch (error) {
      return mutationError(error);
    }
  }

  async lockRound(
    deviceId: string,
    tournamentId: string,
    token: string,
    input: LockRoundInput,
  ): Promise<CoordinatorMutationResult> {
    const lease = await this.acquire(deviceId);
    if (!lease.editable) return leaseDenied(lease);
    try {
      return {
        ok: true,
        payload: await lockCurrentTournamentRound(this.env.DB, tournamentId, token, input),
        lease,
      };
    } catch (error) {
      return mutationError(error);
    }
  }

  async events(
    deviceId: string,
    tournamentId: string,
    token: string,
    input: SyncTournamentEventsInput,
  ): Promise<CoordinatorMutationResult> {
    const lease = await this.acquire(deviceId);
    if (!lease.editable) return leaseDenied(lease);
    try {
      return {
        ok: true,
        payload: await syncTournamentEvents(this.env.DB, tournamentId, token, input),
        lease,
      };
    } catch (error) {
      return mutationError(error);
    }
  }
}

function leaseDenied(lease: EditLeaseStatus): CoordinatorMutationResult {
  return {
    ok: false,
    status: 409,
    code: "edit_lease_required",
    message: "另一台设备持有赛事编辑权",
    lease,
  };
}

function mutationError(error: unknown): CoordinatorMutationResult {
  if (error instanceof TournamentAccessError || error instanceof DraftAccessError) {
    return { ok: false, status: 404, code: "tournament_not_found", message: error.message };
  }
  if (error instanceof TournamentValidationError || error instanceof RangeError) {
    return { ok: false, status: 400, code: "invalid_tournament_operation", message: error.message };
  }
  if (error instanceof TournamentConflictError) {
    return { ok: false, status: 409, code: "tournament_conflict", message: error.message };
  }
  return {
    ok: false,
    status: 500,
    code: "tournament_operation_failed",
    message: error instanceof Error ? error.message : "赛事操作失败",
  };
}
