import { prisma } from "@/lib/db";
import { Uploader } from "./uploader";

export default async function UploadPage({ searchParams }: { searchParams: Promise<{ set?: string }> }) {
  const { set } = await searchParams;
  const sets = await prisma.accountSet.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, postsPerDay: true, _count: { select: { accounts: true } } } });
  return (
    <>
      <h1>Upload</h1>
      {sets.length === 0 ? (
        <div className="alert warn">Create an account set first.</div>
      ) : (
        <Uploader sets={sets.map((s) => ({ id: s.id, name: s.name, postsPerDay: s.postsPerDay, accounts: s._count.accounts }))} initialSet={set} />
      )}
    </>
  );
}
