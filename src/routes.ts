import { Router, Request, Response } from "express";
import { Pool, Snapshot } from "./db";

const router = Router();

// Register a pool for monitoring (idempotent)
router.post("/pools/:address", async (req: Request, res: Response) => {
  const { address } = req.params;
  try {
    await Pool.findOneAndUpdate({ address }, { address }, { upsert: true, new: true });
    res.json({ ok: true, address });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// List all tracked pools
router.get("/pools", async (_req: Request, res: Response) => {
  const pools = await Pool.find().sort({ addedAt: -1 });
  res.json(pools);
});

// Unregister a pool
router.delete("/pools/:address", async (req: Request, res: Response) => {
  const { address } = req.params;
  await Pool.deleteOne({ address });
  res.json({ ok: true });
});

// Get snapshots for a pool — defaults to last 24h
router.get("/snapshots/:address", async (req: Request, res: Response) => {
  const { address } = req.params;
  const from = req.query.from
    ? Number(req.query.from)
    : Date.now() - 24 * 60 * 60 * 1000;

  const snapshots = await Snapshot.find({
    poolAddress: address,
    timestamp: { $gte: from },
  })
    .sort({ timestamp: 1 })
    .lean();

  res.json(snapshots);
});

// Latest snapshot for a pool
router.get("/snapshots/:address/latest", async (req: Request, res: Response) => {
  const { address } = req.params;
  const snapshot = await Snapshot.findOne({ poolAddress: address })
    .sort({ timestamp: -1 })
    .lean();

  if (!snapshot) return res.status(404).json({ error: "No snapshots found" });
  res.json(snapshot);
});

// Snapshot nearest to a given timestamp — used for delta comparisons (1d, 7d, 30d)
router.get("/snapshots/:address/nearest", async (req: Request, res: Response) => {
  const { address } = req.params;
  const t = Number(req.query.t);
  if (!t) return res.status(400).json({ error: "t param required (unix ms)" });

  // Search within a ±2h window around the target to keep the query fast
  const WINDOW = 2 * 60 * 60 * 1000;
  const candidates = await Snapshot.find({
    poolAddress: address,
    timestamp: { $gte: t - WINDOW, $lte: t + WINDOW },
  }).lean();

  if (candidates.length === 0) return res.status(404).json({ error: "No snapshot near that time" });

  const nearest = candidates.reduce((best, s) =>
    Math.abs(s.timestamp - t) < Math.abs(best.timestamp - t) ? s : best
  );
  res.json(nearest);
});

export default router;
