import { memo } from "react";
import { useLivePrice } from "../../custom-hooks/useLivePrice";

interface Props {
  exchange: string;
  symbol: string;
  type: string;
}

const PriceCell: React.FC<Props> = ({ exchange, symbol, type }) => {
  const price = useLivePrice(exchange, symbol, type);

  return <span>{price ?? "-"}</span>;
};

export default memo(PriceCell);
