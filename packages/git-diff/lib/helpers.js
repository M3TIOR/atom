'use babel';

export default async function (goalPath) {
  for (const directory of atom.project.getDirectories()) {
    if (goalPath === directory.getPath() || directory.contains(goalPath)) {
      return await atom.project.repositoryForDirectory(directory);
    }
  }
  return null;
}
