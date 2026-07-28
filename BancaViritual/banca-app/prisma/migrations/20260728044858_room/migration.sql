-- CreateTable
CREATE TABLE "Room" (
    "code" TEXT NOT NULL,
    "state" JSONB NOT NULL,
    "origin" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Room_pkey" PRIMARY KEY ("code")
);
