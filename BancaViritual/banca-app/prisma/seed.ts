import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { PROPERTIES } from '../src/domain/board';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  let n = 0;
  for (const p of PROPERTIES) {
    await prisma.property.upsert({
      where: { expansion_boardIndex: { expansion: p.expansion, boardIndex: p.boardIndex } },
      update: {
        name: p.name,
        type: p.kind,
        colorGroup: p.colorGroup,
        price: p.price,
        rent: p.rent,
        houseCost: p.houseCost,
        mortgage: p.mortgage,
      },
      create: {
        boardIndex: p.boardIndex,
        name: p.name,
        type: p.kind,
        colorGroup: p.colorGroup,
        price: p.price,
        rent: p.rent,
        houseCost: p.houseCost,
        mortgage: p.mortgage,
        expansion: p.expansion,
      },
    });
    n += 1;
  }
  console.log(`Seed OK: ${n} propiedades.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
