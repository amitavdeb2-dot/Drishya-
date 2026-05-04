import { db } from '../lib/firebase';
import { collection, query, where, getDocs, writeBatch, doc } from 'firebase/firestore';

/**
 * Deletes a project and all its related assets across all associated collections.
 * This is a 'hard delete' to maintain database cleanliness.
 */
export async function deleteProject(projectId: string) {
  const batch = writeBatch(db);

  // 1. Scene Data
  const sceneSnap = await getDocs(query(collection(db, 'scenes'), where('projectId', '==', projectId)));
  sceneSnap.forEach(d => batch.delete(d.ref));

  // 2. Storyboard Data
  const storySnap = await getDocs(query(collection(db, 'storyboards'), where('projectId', '==', projectId)));
  storySnap.forEach(d => batch.delete(d.ref));

  // 3. Script Versions & History
  const scriptSnap = await getDocs(query(collection(db, 'scriptVersions'), where('projectId', '==', projectId)));
  scriptSnap.forEach(d => batch.delete(d.ref));

  // 4. Team / Collaborative Memberships
  const teamSnap = await getDocs(query(collection(db, 'projectMembers'), where('projectId', '==', projectId)));
  teamSnap.forEach(d => batch.delete(d.ref));

  // 5. Schedule / Stripboard Items
  const stripSnap = await getDocs(query(collection(db, 'stripboard'), where('projectId', '==', projectId)));
  stripSnap.forEach(d => batch.delete(d.ref));

  // 6. Project Root Record
  batch.delete(doc(db, 'projects', projectId));

  await batch.commit();
}
