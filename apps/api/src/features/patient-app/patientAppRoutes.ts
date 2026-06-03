import { Router } from 'express';
import patientAppRoutesInternal from './patientAppRoutes.internal';

const patientAppRoutes = Router();
patientAppRoutes.use(patientAppRoutesInternal);

export default patientAppRoutes;
