import { createHashRouter } from 'react-router';
import { HomePage } from './pages/HomePage';
import { ProjectPage } from './pages/ProjectPage';

export const router = createHashRouter([
  {
    path: '/',
    Component: HomePage,
  },
  {
    path: '/project/:projectId',
    Component: ProjectPage,
  },
]);
