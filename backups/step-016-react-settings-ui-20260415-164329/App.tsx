import { RouterProvider } from 'react-router';
import { ProjectProvider } from './context/ProjectContext';
import { router } from './routes';

export default function App() {
  return (
    <ProjectProvider>
      <RouterProvider router={router} />
    </ProjectProvider>
  );
}
