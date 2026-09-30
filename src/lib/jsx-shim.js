// Classic-runtime shim for 'react/jsx-runtime' so the artifact build can use React's UMD global.
import React from 'react';

export const Fragment = React.Fragment;
export function jsx(type, props, key) {
  const { children, ...rest } = props || {};
  if (key !== undefined) rest.key = key;
  return children === undefined ? React.createElement(type, rest) : React.createElement(type, rest, children);
}
export function jsxs(type, props, key) {
  const { children, ...rest } = props || {};
  if (key !== undefined) rest.key = key;
  return React.createElement(type, rest, ...(Array.isArray(children) ? children : [children]));
}
export const jsxDEV = jsx;
