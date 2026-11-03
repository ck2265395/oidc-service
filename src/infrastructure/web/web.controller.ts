import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { resolve, sep } from 'node:path';

const publicDirectory = resolve(process.cwd(), 'public');
const consoleDirectory = resolve(publicDirectory, 'app');
const consoleIndex = resolve(consoleDirectory, 'index.html');

function safeFile(root: string, path: string): string {
  const candidate = resolve(root, path);
  if (!candidate.startsWith(root + sep) || path.includes('..') || path.includes('\\')) throw new NotFoundException();
  return candidate;
}

@Controller()
export class WebController {
  @Get()
  root(@Res() response: Response): void { response.sendFile(consoleIndex); }

  @Get('assets/{*path}')
  asset(@Param('path') path: string | string[], @Res() response: Response): void {
    response.setHeader('Cache-Control', 'public, max-age=3600');
    response.sendFile(safeFile(publicDirectory, Array.isArray(path) ? path.join('/') : path));
  }

  @Get('app/{*path}')
  appAsset(@Param('path') path: string | string[], @Res() response: Response): void {
    response.setHeader('Cache-Control', 'public, max-age=3600');
    response.sendFile(safeFile(consoleDirectory, Array.isArray(path) ? path.join('/') : path));
  }

  @Get('admin/login')
  adminLogin(): never { throw new NotFoundException(); }

  @Get(['developer', 'developer/{*path}', 'account', 'account/{*path}', 'admin', 'admin/{*path}'])
  console(@Res() response: Response): void { response.sendFile(consoleIndex); }
}
