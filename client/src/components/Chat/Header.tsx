import { memo } from 'react';

function Header() {
  return null;
}

const MemoizedHeader = memo(Header);
MemoizedHeader.displayName = 'Header';

export default MemoizedHeader;
