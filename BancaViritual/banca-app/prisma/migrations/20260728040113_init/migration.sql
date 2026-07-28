-- CreateEnum
CREATE TYPE "PropertyKind" AS ENUM ('street', 'railroad', 'utility', 'special');

-- CreateEnum
CREATE TYPE "GameStatus" AS ENUM ('active', 'finished');

-- CreateTable
CREATE TABLE "Property" (
    "id" TEXT NOT NULL,
    "boardIndex" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "type" "PropertyKind" NOT NULL DEFAULT 'street',
    "colorGroup" TEXT,
    "price" INTEGER NOT NULL DEFAULT 0,
    "rent" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "houseCost" INTEGER NOT NULL DEFAULT 0,
    "mortgage" INTEGER NOT NULL DEFAULT 0,
    "expansion" TEXT NOT NULL DEFAULT 'base',

    CONSTRAINT "Property_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Game" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "currencySymbol" TEXT NOT NULL DEFAULT '$',
    "status" "GameStatus" NOT NULL DEFAULT 'active',
    "turnIndex" INTEGER NOT NULL DEFAULT 0,
    "settings" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Game_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Player" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT NOT NULL DEFAULT '🙂',
    "colorIndex" INTEGER NOT NULL DEFAULT 0,
    "balance" INTEGER NOT NULL DEFAULT 1500,
    "bankrupt" BOOLEAN NOT NULL DEFAULT false,
    "seat" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Player_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ownership" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "houses" INTEGER NOT NULL DEFAULT 0,
    "mortgaged" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Ownership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "fromPlayerId" TEXT,
    "toPlayerId" TEXT,
    "text" TEXT NOT NULL DEFAULT '',
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trade" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "offeredById" TEXT NOT NULL,
    "offeredToId" TEXT NOT NULL,
    "offer" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Trade_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Property_expansion_idx" ON "Property"("expansion");

-- CreateIndex
CREATE UNIQUE INDEX "Property_expansion_boardIndex_key" ON "Property"("expansion", "boardIndex");

-- CreateIndex
CREATE UNIQUE INDEX "Game_code_key" ON "Game"("code");

-- CreateIndex
CREATE INDEX "Player_gameId_idx" ON "Player"("gameId");

-- CreateIndex
CREATE INDEX "Ownership_gameId_idx" ON "Ownership"("gameId");

-- CreateIndex
CREATE INDEX "Ownership_playerId_idx" ON "Ownership"("playerId");

-- CreateIndex
CREATE UNIQUE INDEX "Ownership_gameId_propertyId_key" ON "Ownership"("gameId", "propertyId");

-- CreateIndex
CREATE INDEX "Transaction_gameId_idx" ON "Transaction"("gameId");

-- CreateIndex
CREATE INDEX "Trade_gameId_idx" ON "Trade"("gameId");

-- AddForeignKey
ALTER TABLE "Player" ADD CONSTRAINT "Player_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ownership" ADD CONSTRAINT "Ownership_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ownership" ADD CONSTRAINT "Ownership_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ownership" ADD CONSTRAINT "Ownership_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_fromPlayerId_fkey" FOREIGN KEY ("fromPlayerId") REFERENCES "Player"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_toPlayerId_fkey" FOREIGN KEY ("toPlayerId") REFERENCES "Player"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_offeredById_fkey" FOREIGN KEY ("offeredById") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_offeredToId_fkey" FOREIGN KEY ("offeredToId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
