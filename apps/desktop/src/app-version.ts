import { z } from 'zod';

import packageJson from '../../../package.json' with { type: 'json' };

const packageMetadataSchema = z.object({ version: z.string() });

const packageMetadata = packageMetadataSchema.parse(packageJson);

export const resolveDesktopAppVersion = ({
  isPackaged,
  packagedVersion,
}: {
  isPackaged: boolean;
  packagedVersion: string;
}): string => (isPackaged ? packagedVersion : packageMetadata.version);
