import { useEffect, useRef, useState, memo } from 'react';
import { getIconComponent } from '../../icons';
import { Car, Flame, MapPin, Thermometer, Zap } from '../../icons';
import { useConfig, useHomeAssistantMeta } from '../../contexts';
import {
  convertValueByKind,
  formatUnitValue,
  getDisplayUnitForKind,
  getEffectiveUnitMode,
} from '../../utils';

/* ─── Helpers (pure, no React) ─── */

const getSafeState = (entities, id) => {
  const state = id ? entities[id]?.state : null;
  if (!state || state === 'unavailable' || state === 'unknown') return null;
  return state;
};

const getNumberState = (entities, id) => {
  const state = getSafeState(entities, id);
  if (state === null) return null;
  const value = parseFloat(state);
  return Number.isFinite(value) ? value : null;
};

const formatValue = (num) => {
  if (num === null || num === undefined) return null;
  const strVal = String(num).replace(',', '.');
  const parsed = parseFloat(strVal);
  if (isNaN(parsed)) return num;
  return Math.round(parsed * 10) / 10;
};

/* ─── CarCard ─── */

const CarCard = ({
  cardId,
  dragProps,
  controls,
  cardStyle,
  entities,
  editMode,
  cardSettings,
  settingsKey,
  customNames,
  customIcons,
  getS,
  getA,
  getEntityImageUrl,
  _callService,
  onOpen,
  isMobile,
  t,
}) => {
  const cardRef = useRef(null);
  const [isNarrowLargeCard, setIsNarrowLargeCard] = useState(false);
  const { unitsMode } = useConfig();
  const { haConfig } = useHomeAssistantMeta();

  useEffect(() => {
    const element = cardRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;

    const updateByWidth = (width) => {
      setIsNarrowLargeCard((prev) => {
        if (prev) return width < 336;
        return width < 316;
      });
    };

    updateByWidth(element.clientWidth);

    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect?.width ?? element.clientWidth;
      updateByWidth(width);
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const settings = cardSettings[settingsKey] || cardSettings[cardId] || {};
  const {
    batteryId,
    rangeId,
    locationId,
    chargingId,
    chargingStateId,
    pluggedId,
    climateId,
    tempId,
    imageUrl,
  } = settings;
  const effectiveChargingId = chargingStateId || chargingId;

  const batteryValue = getNumberState(entities, batteryId);
  const rangeValue = getNumberState(entities, rangeId);
  const effectiveUnitMode = getEffectiveUnitMode(unitsMode, haConfig);
  const sourceRangeUnitRaw = rangeId ? entities[rangeId]?.attributes?.unit_of_measurement : '';
  const sourceRangeUnit = typeof sourceRangeUnitRaw === 'string' ? sourceRangeUnitRaw.trim() : '';
  const useSourceRangeUnit = unitsMode === 'follow_ha' && !!sourceRangeUnit;
  const rangeUnit = useSourceRangeUnit
    ? sourceRangeUnit
    : getDisplayUnitForKind('length', effectiveUnitMode);
  const displayRangeValue = useSourceRangeUnit
    ? rangeValue
    : convertValueByKind(rangeValue, {
        kind: 'length',
        fromUnit: sourceRangeUnit || 'km',
        unitMode: effectiveUnitMode,
      });
  const climateTempValueRaw = climateId ? getA(climateId, 'current_temperature') : null;
  const climateTempValue =
    climateTempValueRaw !== null && climateTempValueRaw !== undefined
      ? parseFloat(climateTempValueRaw)
      : null;
  const sourceTempUnit = tempId
    ? entities[tempId]?.attributes?.unit_of_measurement ||
      haConfig?.unit_system?.temperature ||
      '°C'
    : climateId
      ? entities[climateId]?.attributes?.temperature_unit ||
        haConfig?.unit_system?.temperature ||
        '°C'
      : haConfig?.unit_system?.temperature || '°C';
  const displayTempUnit = getDisplayUnitForKind('temperature', effectiveUnitMode);
  const tempValue =
    getNumberState(entities, tempId) ??
    (Number.isFinite(climateTempValue) ? climateTempValue : null);
  const displayTempValue = convertValueByKind(tempValue, {
    kind: 'temperature',
    fromUnit: sourceTempUnit,
    unitMode: effectiveUnitMode,
  });
  const locationLabel = locationId ? getS(locationId) : null;

  const chargingState = getSafeState(entities, effectiveChargingId);
  const pluggedState = getSafeState(entities, pluggedId);
  const climateEntity = climateId ? entities[climateId] : null;

  const isCharging = chargingState === 'on' || chargingState === 'charging';
  const isPlugged = pluggedState === 'on' || pluggedState === 'plugged' || pluggedState === 'true';
  const isHtg = climateEntity && !['off', 'unavailable', 'unknown'].includes(climateEntity.state);
  const resolvedImageUrl = imageUrl
    ? getEntityImageUrl
      ? getEntityImageUrl(imageUrl)
      : imageUrl
    : null;

  const name = customNames[cardId] || t('car.defaultName');
  const Icon = customIcons[cardId] ? getIconComponent(customIcons[cardId]) || Car : Car;
  const sizeSetting = cardSettings[settingsKey]?.size || cardSettings[cardId]?.size;
  const isSmall = sizeSetting === 'small';
  const isDenseMobile = isMobile && !isSmall;
  const useCompactMetrics = isDenseMobile || isNarrowLargeCard;

  if (isSmall) {
    return (
      <div
        key={cardId}
        {...dragProps}
        data-haptic={editMode ? undefined : 'card'}
        onClick={(e) => {
          e.stopPropagation();
          if (!editMode) onOpen();
        }}
        className={`glass-texture touch-feedback group relative flex h-full items-center justify-between gap-4 overflow-hidden rounded-3xl border p-4 pl-5 font-sans transition-all duration-500 ${!editMode ? 'cursor-pointer active:scale-[0.98]' : 'cursor-move'}`}
        style={{
          ...cardStyle,
          backgroundColor: isHtg ? 'rgba(249, 115, 22, 0.06)' : 'var(--card-bg)',
          borderColor: editMode
            ? 'rgba(59, 130, 246, 0.2)'
            : isHtg
              ? 'rgba(249, 115, 22, 0.2)'
              : 'var(--card-border)',
        }}
      >
        {controls}
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <div
            className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl transition-all group-hover:scale-110 ${isHtg ? 'animate-pulse bg-orange-500/20 text-orange-400' : isCharging ? 'bg-[var(--status-success-bg)] text-[var(--status-success-fg)]' : 'bg-[var(--glass-bg)] text-[var(--text-secondary)]'}`}
          >
            <Icon className="h-6 w-6 stroke-[1.5px]" />
          </div>
          <div className="flex min-w-0 flex-col">
            <p className="mb-1.5 truncate text-xs leading-none font-bold tracking-widest text-[var(--text-secondary)] uppercase opacity-60">
              {name}
            </p>
            <div className="flex flex-col gap-0.5 leading-tight">
              <span
                className={`text-sm font-bold ${isCharging ? 'text-[var(--status-success-fg)]' : 'text-[var(--text-primary)]'}`}
              >
                {batteryValue !== null ? `${formatValue(batteryValue)}%` : '--'}
              </span>
              {displayRangeValue !== null && (
                <span className="text-xs text-[var(--text-secondary)]">
                  {formatUnitValue(displayRangeValue, { fallback: '--' })} {rangeUnit}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={cardRef}
      key={cardId}
      {...dragProps}
      data-haptic={editMode ? undefined : 'card'}
      onClick={(e) => {
        e.stopPropagation();
        if (!editMode) onOpen();
      }}
      className={`glass-texture touch-feedback group relative flex h-full flex-col justify-between overflow-hidden rounded-3xl border font-sans transition-all duration-500 ${isDenseMobile ? 'p-5' : 'p-7'} ${!editMode ? 'cursor-pointer active:scale-98' : 'cursor-move'}`}
      style={{
        ...cardStyle,
        backgroundColor: isHtg ? 'rgba(249, 115, 22, 0.08)' : 'var(--card-bg)',
        borderColor: editMode
          ? 'rgba(59, 130, 246, 0.2)'
          : isHtg
            ? 'rgba(249, 115, 22, 0.3)'
            : 'var(--card-border)',
      }}
    >
      {controls}
      <div className={`flex items-start justify-between font-sans ${isDenseMobile ? 'gap-3' : ''}`}>
        <div
          className={`transition-all group-hover:scale-110 ${isHtg ? 'animate-pulse bg-orange-500/20 text-orange-400' : isCharging ? 'bg-[var(--status-success-bg)] text-[var(--status-success-fg)]' : 'bg-[var(--glass-bg)] text-[var(--text-secondary)]'} ${isDenseMobile ? 'rounded-xl p-2.5' : 'rounded-2xl p-3'}`}
        >
          <Icon className={`${isDenseMobile ? 'h-4 w-4' : 'h-5 w-5'} stroke-[1.5px]`} />
        </div>
        <div className={`flex max-w-[65%] flex-col items-end ${isDenseMobile ? 'gap-1.5' : 'gap-2'}`}>
          {locationLabel && (
            <div
              className={`flex max-w-full items-start border border-[var(--glass-border)] bg-[var(--glass-bg)] text-[var(--text-secondary)] ${isDenseMobile ? 'gap-1 rounded-xl px-2.5 py-1' : 'gap-1.5 rounded-2xl px-3 py-1.5'}`}
            >
              <MapPin className={`${isDenseMobile ? 'mt-0 h-2.5 w-2.5' : 'mt-0.5 h-3 w-3'} flex-shrink-0`} />
              <span
                className={`${isDenseMobile ? 'text-[10px]' : 'text-xs'} leading-tight font-bold tracking-widest break-words whitespace-normal uppercase`}
              >
                {String(locationLabel)}
              </span>
            </div>
          )}
          {tempValue !== null && !isDenseMobile && (
            <div className="flex items-center gap-1.5 rounded-full border border-[var(--glass-border)] bg-[var(--glass-bg)] px-3 py-1.5 text-[var(--text-secondary)]">
              <Thermometer className="h-3 w-3" />
              <span className="text-xs font-bold tracking-widest uppercase">
                {formatUnitValue(displayTempValue, { fallback: '--' })}
                {displayTempUnit}
              </span>
            </div>
          )}
          {isHtg && (
            <div
              className={`flex animate-pulse items-center rounded-full border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] text-[var(--status-warning-fg)] ${isDenseMobile ? 'gap-1 px-2.5 py-1' : 'gap-1.5 px-3 py-1.5'}`}
            >
              <Flame className={isDenseMobile ? 'h-2.5 w-2.5' : 'h-3 w-3'} />
              <span className={`${isDenseMobile ? 'text-[10px]' : 'text-xs'} font-bold tracking-widest uppercase`}>
                {t('car.heating')}
              </span>
            </div>
          )}
        </div>
      </div>
      <div className={`flex items-end justify-between ${useCompactMetrics ? 'gap-3' : 'gap-4'}`}>
        <div className="min-w-0 flex-1">
          <p
            className={`${isDenseMobile ? 'mb-0.5 text-[10px]' : 'mb-1 text-xs'} font-bold tracking-widest text-[var(--text-secondary)] uppercase opacity-60`}
          >
            {name}
          </p>
          <div className={`flex min-w-0 items-baseline font-sans leading-none ${useCompactMetrics ? 'gap-1.5' : 'gap-2'}`}>
            <span
              className={`${useCompactMetrics ? 'text-[2rem]' : 'text-4xl'} leading-none font-thin ${isCharging ? 'text-[var(--status-success-fg)]' : 'text-[var(--text-primary)]'}`}
            >
              {batteryValue !== null ? `${formatValue(batteryValue)}%` : '--'}
            </span>
            {isCharging && (
              <Zap
                className={`${useCompactMetrics ? 'mb-0.5 h-4 w-4' : 'mb-1 -ml-1 h-5 w-5'} animate-pulse text-[var(--status-success-fg)]`}
                fill="currentColor"
              />
            )}
            {displayRangeValue !== null && (
              <span
                className={`${useCompactMetrics ? 'text-base' : 'ml-1 text-xl'} min-w-0 truncate font-light text-[var(--text-secondary)]`}
              >
                {formatUnitValue(displayRangeValue, { fallback: '--' })}
                {rangeUnit}
              </span>
            )}
          </div>
          {pluggedId && (
            <p className="mt-2 text-[10px] font-bold tracking-widest text-[var(--text-muted)] uppercase opacity-60">
              {isPlugged ? t('car.pluggedIn') : t('car.unplugged')}
            </p>
          )}
        </div>
        {resolvedImageUrl && (
          <img
            src={resolvedImageUrl}
            alt=""
            className={`pointer-events-none h-20 w-auto object-contain opacity-80 drop-shadow-lg select-none ${useCompactMetrics ? 'max-w-[38%]' : 'max-w-[45%]'}`}
            onError={(e) => {
              e.target.style.display = 'none';
            }}
          />
        )}
      </div>
    </div>
  );
};

export default memo(CarCard);
