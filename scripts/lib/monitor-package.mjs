export function assertPortableNodeLinks(otoolOutput) {
  // The first line names the inspected file and can contain the build user's
  // path. Only subsequent lines describe dynamically loaded dependencies.
  const dependencies=otoolOutput.split('\n').slice(1).map(line=>line.trim().split(' (')[0]).filter(Boolean);
  if(!dependencies.length || dependencies.some(dep=>!dep.startsWith('/usr/lib/') && !dep.startsWith('/System/Library/'))) {
    throw Error('Use the official self-contained Node 22 binary, not a Homebrew or externally linked runtime');
  }
}
