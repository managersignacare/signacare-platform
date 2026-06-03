// apps/api/src/routes/clinicRoutes.ts
import { Router } from "express";
import {
  listClinicsController,
  getClinicController,
  createClinicController,
  updateClinicController,
  getMyClinicController,
  updateMyClinicController,
  validateClinicCreate,
  validateClinicUpdate,
} from "./clinicController";
import { authMiddleware } from "../../middleware/authMiddleware";
import { requirePermission } from "../../middleware/rbacMiddleware";

export const clinicRouter = Router();

clinicRouter.use(authMiddleware);

// Lookup endpoint — superadmin gets all clinics; all other roles only
// get their own clinic row to preserve tenant isolation.
clinicRouter.get("/lookup", async (req, res, next) => {
  try {
    const { dbAdmin } = await import("../../db/db");
    const isSuperadmin = req.user?.role === "superadmin";
    const query = dbAdmin("clinics")
      .select("id", "name")
      .whereNull("deleted_at")
      .orderBy("name");
    if (!isSuperadmin) {
      query.where({ id: req.clinicId });
    }
    const clinics = await query;
    res.json(clinics);
  } catch (err) {
    next(err);
  }
});

clinicRouter.get("/me", requirePermission("clinic:read"), getMyClinicController);
clinicRouter.patch("/me", requirePermission("clinic:update"), validateClinicUpdate, updateMyClinicController);
clinicRouter.get("/", requirePermission("clinic:read"), listClinicsController);
clinicRouter.get("/:id", requirePermission("clinic:read"), getClinicController);
clinicRouter.post("/", requirePermission("clinic:create"), validateClinicCreate, createClinicController);
clinicRouter.put("/:id", requirePermission("clinic:update"), validateClinicUpdate, updateClinicController);
