import type { PreparedCustomFieldWrite } from "@/server/custom-fields/types";
import type { Ulid } from "@/server/ids";

import type {
    NoteCompanyRecord,
    NoteCountInclude,
    NoteListPage,
    NoteListQuery,
    NoteOpportunityRecord,
    NotePersonRecord,
    NoteRecord,
    NoteRelationshipCounts,
    NoteRelationshipSyncs,
    NoteUserRecord,
    NoteableType,
} from "./types";

export type CreateNoteTransaction = Readonly<{
    id: Ulid;
    teamId: Ulid;
    creatorId: Ulid;
    title: string;
    creationSource: "api";
    occurredAt: Date;
    relationships: NoteRelationshipSyncs;
    customFields: PreparedCustomFieldWrite;
}>;

export type UpdateNoteTransaction = Readonly<{
    id: Ulid;
    teamId: Ulid;
    occurredAt: Date;
    relationships: NoteRelationshipSyncs;
    title?: string;
    customFields?: PreparedCustomFieldWrite;
}>;

export interface NotesRepository {
    list(teamId: Ulid, query: NoteListQuery): Promise<NoteListPage>;
    find(teamId: Ulid, noteId: Ulid): Promise<NoteRecord | undefined>;
    findOwnedRelationshipIds(
        teamId: Ulid,
        type: NoteableType,
        ids: readonly Ulid[],
    ): Promise<ReadonlySet<Ulid>>;
    create(input: CreateNoteTransaction): Promise<NoteRecord>;
    update(
        input: UpdateNoteTransaction,
        causerId: Ulid,
    ): Promise<NoteRecord | undefined>;
    softDelete(
        teamId: Ulid,
        noteId: Ulid,
        occurredAt: Date,
        causerId: Ulid,
    ): Promise<boolean>;
    loadUsers(
        teamId: Ulid,
        notes: readonly NoteRecord[],
    ): Promise<readonly NoteUserRecord[]>;
    loadCompanies(
        teamId: Ulid,
        noteIds: readonly Ulid[],
    ): Promise<readonly NoteCompanyRecord[]>;
    loadPeople(
        teamId: Ulid,
        noteIds: readonly Ulid[],
    ): Promise<readonly NotePersonRecord[]>;
    loadOpportunities(
        teamId: Ulid,
        noteIds: readonly Ulid[],
    ): Promise<readonly NoteOpportunityRecord[]>;
    loadRelationshipCounts(
        teamId: Ulid,
        noteIds: readonly Ulid[],
        includes: readonly NoteCountInclude[],
    ): Promise<ReadonlyMap<Ulid, NoteRelationshipCounts>>;
}
