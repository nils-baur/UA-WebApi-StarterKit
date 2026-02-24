import React from 'react';
import HomePage from './pages/HomePage';
//import LoginPage from './pages/LoginPage';
import Swagger from './Swagger';

export interface PageRoute {
   name: string
   path: string
   element: React.ReactNode
   appId: number
}

const AppRoutes : PageRoute[] = [
   {
      name: "main.home",
      path: '/',
      appId: 1,
      element: <HomePage />
   },
   {
      name: "main.swagger",
      path: '/swagger',
      appId: 1,
      element: <Swagger />
   }
];

export default AppRoutes;
