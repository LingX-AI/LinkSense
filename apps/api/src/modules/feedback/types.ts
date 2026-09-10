import type { Readable } from "node:stream";

import type {
  AdminFeedbackPage,
  FeedbackDetails,
  FeedbackImageMimeType,
  FeedbackSubmissionResult,
} from "@linksense/shared";

export type FeedbackActor = {
  id: string;
  name: string;
  email: string;
  role: "user" | "admin";
  status: "active";
};

export type FeedbackUpload = {
  filename: string;
  declaredMimeType: string;
  bytes: Buffer;
};

export type FeedbackImageRecord = {
  id: string;
  feedbackId: string;
  objectKey: string;
  filename: string;
  mimeType: FeedbackImageMimeType;
  sizeBytes: number;
  checksumSha256: string;
  sortOrder: number;
  createdAt: Date;
};

export type CreateFeedbackRecord = {
  id: string;
  submitterId: string;
  submitterName: string;
  submitterEmail: string;
  content: string;
  createdAt: Date;
  images: FeedbackImageRecord[];
};

export type DeletedFeedbackRecord = {
  id: string;
  imageObjectKeys: string[];
};

export type CreateFeedbackReplyRecord = {
  id: string;
  feedbackId: string;
  authorId: string;
  content: string;
  createdAt: Date;
  images: FeedbackImageRecord[];
};

export interface FeedbackStore {
  createReply(
    input: CreateFeedbackReplyRecord,
  ): Promise<FeedbackSubmissionResult>;
  findDetails(input: {
    feedbackId: string;
    submitterId?: string;
  }): Promise<FeedbackDetails | null>;
  exists(input: { feedbackId: string; submitterId?: string }): Promise<boolean>;
  create(input: CreateFeedbackRecord): Promise<FeedbackSubmissionResult>;
  list(input: {
    cursor?: string;
    limit: number;
    submitterId?: string;
  }): Promise<AdminFeedbackPage>;
  findImage(input: {
    feedbackId: string;
    imageId: string;
    replyId?: string;
  }): Promise<FeedbackImageRecord | null>;
  delete(feedbackId: string): Promise<DeletedFeedbackRecord | null>;
}

export interface FeedbackStorage {
  putObject(
    key: string,
    data: Buffer,
    metadata?: Record<string, string>,
  ): Promise<void>;
  getObjectSize(key: string): Promise<number>;
  getObjectStream(key: string): Promise<Readable>;
  removeObject(key: string): Promise<void>;
}

export interface FeedbackCleanup {
  scheduleObjectRemoval(objectKey: string): Promise<void>;
}

export interface FeedbackAudit {
  write(
    input:
      | {
          actorId: string;
          action: "feedback_submitted" | "feedback_replied";
          targetType: "feedback";
          targetId: string;
          result: "success";
          metadata: { image_count: number; content_length: number };
          ipAddress?: string | null;
          userAgent?: string | null;
        }
      | {
          actorId: string;
          action: "feedback_deleted";
          targetType: "feedback";
          targetId: string;
          result: "success";
          metadata: { image_count: number };
          ipAddress?: string | null;
          userAgent?: string | null;
        },
  ): Promise<void>;
}

export type FeedbackImageContent = {
  data: Readable;
  filename: string;
  mimeType: FeedbackImageMimeType;
  sizeBytes: number;
};
