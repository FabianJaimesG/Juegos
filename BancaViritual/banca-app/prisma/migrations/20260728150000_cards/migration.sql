-- CreateEnum
CREATE TYPE "DeckId" AS ENUM ('arca', 'fortuna', 'bonificacion');

-- CreateTable
CREATE TABLE "Card" (
    "id" TEXT NOT NULL,
    "deck" "DeckId" NOT NULL,
    "pack" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "emoji" TEXT NOT NULL DEFAULT '🃏',
    "effect" JSONB NOT NULL,
    "keep" BOOLEAN NOT NULL DEFAULT false,
    "copies" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Card_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Card_pack_idx" ON "Card"("pack");

-- CreateIndex
CREATE INDEX "Card_deck_pack_idx" ON "Card"("deck", "pack");
