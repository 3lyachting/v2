import { Router } from "express";

const router = Router();

router.all("*", (_req, res) => {
  res.status(410).json({
    error: "Legacy booking/calendar API disabled during rebuild",
    code: "BOOKING_REBUILD_IN_PROGRESS",
  });
});

export default router;
